import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Env } from './env.js';
import {
  AllProvidersFailedError,
  LLM_PROVIDER_ENDPOINTS,
  LlmOutputValidationError,
  createFallbackLlmClient,
} from './llm.js';
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'llm.test' });

const baseInput = {
  messages: [{ role: 'user' as const, content: 'hi' }],
  runId: 'run-1',
  stepId: 'step-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function chatCompletion(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

describe('createFallbackLlmClient.complete', () => {
  it('falls back from gemini to groq when gemini fails', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      gemini: { apiKey: 'g', model: 'gemini-model' },
      groq: { apiKey: 'q', model: 'groq-model' },
    };
    const fetchImpl = vi.fn((url: string | URL | Request) => {
      if (url === LLM_PROVIDER_ENDPOINTS.gemini) return Promise.resolve(jsonResponse('boom', 500));
      if (url === LLM_PROVIDER_ENDPOINTS.groq)
        return Promise.resolve(jsonResponse(chatCompletion('groq says hi')));
      return Promise.reject(new Error('unexpected url in test'));
    });
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    const result = await client.complete(baseInput);
    expect(result).toEqual({ text: 'groq says hi', provider: 'groq', model: 'groq-model' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws AllProvidersFailedError when every configured provider fails', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'groq-model' },
    };
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse('nope', 500)));
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    await expect(client.complete(baseInput)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });
});

describe('createFallbackLlmClient.complete request shape', () => {
  it('defaults max_tokens high enough for a full structured response, not the old 1024 that truncated real drafts', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'm' },
    };
    const fetchImpl = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(chatCompletion('hi'))),
    );
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    await client.complete(baseInput);

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    if (!init) throw new Error('expected fetchImpl to have been called');
    const body = JSON.parse(init.body as string) as { max_tokens: number };
    expect(body.max_tokens).toBeGreaterThanOrEqual(4096);
  });

  it('lets a caller override max_tokens explicitly', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'm' },
    };
    const fetchImpl = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(chatCompletion('hi'))),
    );
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    await client.complete({ ...baseInput, maxTokens: 256 });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    if (!init) throw new Error('expected fetchImpl to have been called');
    const body = JSON.parse(init.body as string) as { max_tokens: number };
    expect(body.max_tokens).toBe(256);
  });
});

describe('createFallbackLlmClient.completeStructured', () => {
  const schema = z.object({ greeting: z.string() });

  it('parses valid JSON on the first attempt', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'm' },
    };
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(chatCompletion(JSON.stringify({ greeting: 'hi' })))),
    );
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    const result = await client.completeStructured(baseInput, schema);
    expect(result).toEqual({ greeting: 'hi' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('strips a markdown JSON code fence with a trailing newline after the closing fence', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'm' },
    };
    // Reproduces a real provider response shape: some models append trailing
    // whitespace after the closing ``` fence, which an anchored ^...$ regex misses.
    const fenced = '```json\n{"greeting": "hi"}\n```\n';
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(chatCompletion(fenced))));
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    const result = await client.completeStructured(baseInput, schema);
    expect(result).toEqual({ greeting: 'hi' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('strips a markdown JSON code fence preceded by leading commentary', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'm' },
    };
    const fenced = 'Here is the JSON:\n```json\n{"greeting": "hi"}\n```';
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(chatCompletion(fenced))));
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    const result = await client.completeStructured(baseInput, schema);
    expect(result).toEqual({ greeting: 'hi' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('repairs once when the first response is invalid, then succeeds', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'm' },
    };
    let call = 0;
    const fetchImpl = vi.fn(() => {
      call += 1;
      if (call === 1) return Promise.resolve(jsonResponse(chatCompletion('not json at all')));
      return Promise.resolve(jsonResponse(chatCompletion(JSON.stringify({ greeting: 'fixed' }))));
    });
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    const result = await client.completeStructured(baseInput, schema);
    expect(result).toEqual({ greeting: 'fixed' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the JSON schema instruction in the system prompt on the repair attempt too', async () => {
    // Found live: the repair call previously reused the caller's bare `input` (which
    // spreads over the schema-augmented system built for the first attempt), so on
    // retry the model lost the schema instruction entirely and had even less context
    // to recover from its first mistake.
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'm' },
    };
    let call = 0;
    const systemPromptsSeen: string[] = [];
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      call += 1;
      const body = JSON.parse(init?.body as string) as {
        messages: { role: string; content: string }[];
      };
      const systemMessage = body.messages.find((m) => m.role === 'system');
      systemPromptsSeen.push(systemMessage?.content ?? '');
      if (call === 1) return Promise.resolve(jsonResponse(chatCompletion('not json at all')));
      return Promise.resolve(jsonResponse(chatCompletion(JSON.stringify({ greeting: 'fixed' }))));
    });
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    await client.completeStructured(baseInput, schema);

    expect(systemPromptsSeen).toHaveLength(2);
    expect(systemPromptsSeen[0]).toContain('JSON Schema');
    expect(systemPromptsSeen[1]).toContain('JSON Schema');
    expect(systemPromptsSeen[0]).toBe(systemPromptsSeen[1]);
  });

  it('throws LlmOutputValidationError when both attempts fail', async () => {
    const env: Env = {
      databaseUrl: 'x',
      apiPort: 4000,
      apiHost: '127.0.0.1',
      visualAgentEnabled: false,
      groq: { apiKey: 'q', model: 'm' },
    };
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(chatCompletion('still not json'))));
    const client = createFallbackLlmClient(env, logger, { fetchImpl });

    await expect(client.completeStructured(baseInput, schema)).rejects.toBeInstanceOf(
      LlmOutputValidationError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
