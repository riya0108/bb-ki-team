import type { BetaContentBlock, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it, vi } from 'vitest';

import type { AnthropicApiConfig, AnthropicMessageStreamer } from './anthropicApi.js';
import { finalAnswerText, runAnthropicApi, serverToolCalls } from './anthropicApi.js';
import type { ClaudeCodeConfig } from './claudeCode.js';
import type { Env } from './env.js';
import { loadEnv } from './env.js';
import { createBlogLlmClient } from './llm.js';
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'anthropicApi.test' });
const config: AnthropicApiConfig = { kind: 'anthropic-api', apiKey: 'sk-test', model: 'claude-opus-5-5' };

function message(content: unknown[], stop_reason: string, extra: Record<string, unknown> = {}): BetaMessage {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
    ...extra,
  } as unknown as BetaMessage;
}

const searchUse = { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'RBI repo rate' } };
const searchResult = { type: 'web_search_tool_result', tool_use_id: 's1', content: [] };
const fetchUse = { type: 'server_tool_use', id: 'f1', name: 'web_fetch', input: { url: 'https://rbi.org.in/x' } };
const fetchResult = { type: 'web_fetch_tool_result', tool_use_id: 'f1', content: {} };
const text = (t: string): unknown => ({ type: 'text', text: t });

describe('finalAnswerText / serverToolCalls', () => {
  it('keeps only the text after the last web-tool exchange and maps tool names', () => {
    const blocks = [text('Let me search.'), searchUse, searchResult, text('Now fetch.'), fetchUse, fetchResult, text('{"leads":'), text('[]}')] as BetaContentBlock[];
    expect(finalAnswerText(blocks)).toBe('{"leads":[]}');
    expect(serverToolCalls(blocks)).toEqual([
      { name: 'WebSearch', input: { query: 'RBI repo rate' } },
      { name: 'WebFetch', input: { url: 'https://rbi.org.in/x' } },
    ]);
  });
});

describe('runAnthropicApi', () => {
  it('sends a plain completion with no tools, adaptive thinking, high effort and fallbacks', async () => {
    const streamer = vi.fn<AnthropicMessageStreamer>().mockResolvedValue(message([text('article')], 'end_turn'));
    const result = await runAnthropicApi(config, { system: 'S', prompt: 'P', tools: [], runId: 'r', stepId: 's' }, logger, streamer);
    expect(result).toEqual({ text: 'article', model: 'claude-opus-5-5', costUsd: null, toolCalls: [] });
    const params = streamer.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'S',
      messages: [{ role: 'user', content: 'P' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      fallbacks: 'default',
    });
    expect(params).not.toHaveProperty('tools');
  });

  it('gives research calls web search + fetch, continues a paused turn, and reports every tool call', async () => {
    const streamer = vi
      .fn<AnthropicMessageStreamer>()
      .mockResolvedValueOnce(message([searchUse, searchResult], 'pause_turn'))
      .mockResolvedValueOnce(message([fetchUse, fetchResult, text('{"leads":[]}')], 'end_turn'));
    const onToolCall = vi.fn();
    const result = await runAnthropicApi(
      config,
      { system: 'S', prompt: 'P', tools: ['WebSearch', 'WebFetch'], runId: 'r', stepId: 's', onToolCall },
      logger,
      streamer,
    );
    expect(result.text).toBe('{"leads":[]}');
    expect(result.toolCalls.map((c) => c.name)).toEqual(['WebSearch', 'WebFetch']);
    expect(onToolCall).toHaveBeenCalledTimes(2);
    const first = streamer.mock.calls[0]?.[0];
    expect(first?.tools?.map((t) => ('type' in t ? t.type : ''))).toEqual(['web_search_20260209', 'web_fetch_20260209']);
    // The continuation resends the paused assistant turn.
    const second = streamer.mock.calls[1]?.[0];
    expect(second?.messages).toHaveLength(2);
    expect(second?.messages[1]).toMatchObject({ role: 'assistant' });
  });

  it('fails on a refusal so the caller can fall back', async () => {
    const streamer = vi.fn<AnthropicMessageStreamer>().mockResolvedValue(message([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber' } }));
    await expect(runAnthropicApi(config, { system: 'S', prompt: 'P', tools: [], runId: 'r', stepId: 's' }, logger, streamer)).rejects.toThrow(/declined/);
  });
});

describe('Blog backends from env', () => {
  const base = { DATABASE_URL: 'postgres://x', GEMINI_API_KEY: 'g', GEMINI_MODEL: 'm' };

  it('enables the API backend from ANTHROPIC_API_KEY with Opus 5.5 by default', () => {
    const env = loadEnv({ ...base, ANTHROPIC_API_KEY: 'sk-test' });
    expect(env.blogClaude).toEqual([{ kind: 'anthropic-api', apiKey: 'sk-test', model: 'claude-opus-5-5' }]);
  });

  it('orders the local CLI before the API when both are set', () => {
    const env = loadEnv({ ...base, ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_BLOG_EFFORT: 'max', CLAUDE_CODE_MODEL: 'opus' });
    expect(env.blogClaude).toEqual([{ model: 'opus' }, { kind: 'anthropic-api', apiKey: 'sk-test', model: 'claude-opus-5-5', effort: 'max' }]);
  });

  it('falls through CLI -> API in the blog client', async () => {
    const cli: ClaudeCodeConfig = { model: 'opus' };
    const env: Env = { databaseUrl: 'x', apiPort: 4000, apiHost: '127.0.0.1', visualAgentEnabled: false, gemini: { apiKey: 'g', model: 'm' }, blogClaude: [cli, config] };
    const runClaude = vi
      .fn()
      .mockRejectedValueOnce(new Error('claude: command not found'))
      .mockResolvedValueOnce({ text: 'from api', model: 'claude-opus-5-5', costUsd: null, toolCalls: [] });
    const fetchImpl = vi.fn();
    const client = createBlogLlmClient(env, logger, { fetchImpl, runClaude });
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }], runId: 'r', stepId: 's' });
    expect(result).toEqual({ text: 'from api', provider: 'anthropic-api', model: 'claude-opus-5-5' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
