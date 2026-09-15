import { z } from 'zod';

import type { Env, LlmProviderConfig } from './env.js';
import type { Logger } from './logger.js';

export type LlmProviderName = 'gemini' | 'groq' | 'openrouter' | 'ollama';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionInput {
  system?: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  runId: string;
  stepId: string;
}

export interface LlmCompletionResult {
  text: string;
  provider: LlmProviderName;
  model: string;
}

export interface LlmClient {
  complete(input: LlmCompletionInput): Promise<LlmCompletionResult>;
  completeStructured<T>(input: LlmCompletionInput, schema: z.ZodType<T>): Promise<T>;
}

export class AllProvidersFailedError extends Error {
  constructor(public readonly attempts: { provider: LlmProviderName; error: string }[]) {
    super(`All configured LLM providers failed: ${attempts.map((a) => `${a.provider}: ${a.error}`).join('; ')}`);
    this.name = 'AllProvidersFailedError';
  }
}

export class LlmOutputValidationError extends Error {
  constructor(
    public readonly rawText: string,
    public readonly zodError: string,
  ) {
    super(`LLM output failed schema validation after repair retry: ${zodError}`);
    this.name = 'LlmOutputValidationError';
  }
}

interface ProviderSpec {
  name: LlmProviderName;
  baseUrl: string;
  config: LlmProviderConfig;
}

export const LLM_PROVIDER_ENDPOINTS: Record<LlmProviderName, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  // Local, via `brew services start ollama` — no account, no API key, no billing
  // surface of any kind (see packages/core/src/env.ts's comment on why `config.apiKey`
  // is a hardcoded placeholder here rather than something the user configures).
  ollama: 'http://localhost:11434/v1/chat/completions',
};

const REQUEST_TIMEOUT_MS = 30_000;

function buildProviderList(env: Env): ProviderSpec[] {
  const providers: ProviderSpec[] = [];
  if (env.gemini) providers.push({ name: 'gemini', baseUrl: LLM_PROVIDER_ENDPOINTS.gemini, config: env.gemini });
  if (env.groq) providers.push({ name: 'groq', baseUrl: LLM_PROVIDER_ENDPOINTS.groq, config: env.groq });
  if (env.openrouter) {
    providers.push({ name: 'openrouter', baseUrl: LLM_PROVIDER_ENDPOINTS.openrouter, config: env.openrouter });
  }
  // Last in the fallback order deliberately — added as a fourth safety net after
  // gemini/groq/openrouter all hit rate limits/quota at once on the same free-tier
  // account (2026-09-15 incident), not as a replacement for any of them. Local, so
  // it's slower and lower-quality than the cloud providers above — a fallback of
  // last resort, not something to prefer.
  if (env.ollama) {
    providers.push({ name: 'ollama', baseUrl: LLM_PROVIDER_ENDPOINTS.ollama, config: env.ollama });
  }
  return providers;
}

async function callOpenAiCompatible(
  spec: ProviderSpec,
  input: LlmCompletionInput,
  fetchImpl: typeof fetch,
): Promise<string> {
  const messages = [
    ...(input.system ? [{ role: 'system' as const, content: input.system }] : []),
    ...input.messages,
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(spec.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${spec.config.apiKey}`,
      },
      body: JSON.stringify({
        model: spec.config.model,
        messages,
        temperature: input.temperature ?? 0.7,
        // 1024 was too small in practice: a full structured LinkedIn post response
        // (hookOptions + finalPost + the rest of DraftLinkedinPostOutputSchema, plus
        // markdown-fence/indentation overhead) routinely got cut off mid-JSON, which
        // completeStructured then couldn't parse or repair (found via live testing).
        max_tokens: input.maxTokens ?? 4096,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable body>');
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('provider returned no message content');
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

// Not anchored to the whole string: some providers add trailing whitespace/newlines
// after the closing fence, or leading commentary before the opening one, either of
// which would fail a ^...$-anchored match and silently fall through to parsing the
// still-fenced text as JSON.
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

export interface CreateFallbackLlmClientOptions {
  fetchImpl?: typeof fetch;
}

export function createFallbackLlmClient(
  env: Env,
  logger: Logger,
  options: CreateFallbackLlmClientOptions = {},
): LlmClient {
  const providers = buildProviderList(env);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const attempts: { provider: LlmProviderName; error: string }[] = [];
    for (const spec of providers) {
      try {
        const text = await callOpenAiCompatible(spec, input, fetchImpl);
        return { text, provider: spec.name, model: spec.config.model };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { provider: spec.name, runId: input.runId, stepId: input.stepId, err: message },
          'LLM provider call failed, trying next provider',
        );
        attempts.push({ provider: spec.name, error: message });
      }
    }
    throw new AllProvidersFailedError(attempts);
  }

  async function completeStructured<T>(input: LlmCompletionInput, schema: z.ZodType<T>): Promise<T> {
    // "matching this shape" reads to some models as "here is an example to reproduce" —
    // found live, a model echoed the JSON Schema itself (with $schema/properties/required
    // keys) instead of an instance conforming to it. Spelled out explicitly to head that off.
    const jsonSchemaInstruction = `Respond with ONLY a JSON value that conforms to this JSON Schema (no markdown fences, no commentary). Return DATA satisfying the schema, never the schema definition itself: ${JSON.stringify(z.toJSONSchema(schema))}`;
    const systemWithSchema = input.system ? `${input.system}\n\n${jsonSchemaInstruction}` : jsonSchemaInstruction;
    const firstAttempt = await complete({ ...input, system: systemWithSchema });

    const tryParse = (text: string): { ok: true; value: T } | { ok: false; error: string } => {
      let candidate: unknown;
      try {
        candidate = JSON.parse(stripJsonFences(text));
      } catch (error) {
        return { ok: false, error: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
      }
      const result = schema.safeParse(candidate);
      if (result.success) return { ok: true, value: result.data };
      return { ok: false, error: result.error.message };
    };

    const first = tryParse(firstAttempt.text);
    if (first.ok) return first.value;

    logger.warn(
      { runId: input.runId, stepId: input.stepId, error: first.error },
      'LLM structured output failed validation, retrying once with repair instruction',
    );

    const repairAttempt = await complete({
      ...input,
      system: systemWithSchema,
      messages: [
        ...input.messages,
        { role: 'assistant', content: firstAttempt.text },
        {
          role: 'user',
          content: `Your last response was invalid: ${first.error}. Return corrected JSON data only — not the schema — matching the required shape exactly.`,
        },
      ],
    });

    const second = tryParse(repairAttempt.text);
    if (second.ok) return second.value;

    throw new LlmOutputValidationError(repairAttempt.text, second.error);
  }

  return { complete, completeStructured };
}
