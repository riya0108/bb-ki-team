import { describe, expect, it, vi } from 'vitest';

import type { ClaudeCodeConfig } from './claudeCode.js';
import {
  buildClaudeCodeArgs,
  claudeCodeChildEnv,
  claudeCodeStreamLineIsProgress,
  parseClaudeCodeStream,
  renderClaudeCodePrompt,
} from './claudeCode.js';
import type { Env } from './env.js';
import { AllProvidersFailedError, createBlogLlmClient, createFallbackLlmClient } from './llm.js';
import { createLogger } from './logger.js';

const logger = createLogger({ module: 'claudeCode.test' });
const config: ClaudeCodeConfig = { model: 'opus' };

describe('claudeCodeChildEnv', () => {
  it('passes only PATH/HOME/locale — never secrets or ANTHROPIC_API_KEY', () => {
    const env = claudeCodeChildEnv({
      PATH: '/bin',
      HOME: '/Users/x',
      LANG: 'en_US.UTF-8',
      DATABASE_URL: 'postgres://secret',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      GEMINI_API_KEY: 'g',
      BUFFER_ACCESS_TOKEN: 'b',
      CLAUDECODE: '1',
    });
    expect(env).toEqual({ PATH: '/bin', HOME: '/Users/x', LANG: 'en_US.UTF-8' });
  });
});

describe('buildClaudeCodeArgs', () => {
  it('disables every tool and MCP server for plain completions', () => {
    const args = buildClaudeCodeArgs(config, 'SYS', []);
    expect(args).toEqual(expect.arrayContaining(['-p', '--model', 'opus', '--system-prompt', 'SYS', '--strict-mcp-config', '--no-session-persistence']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).not.toContain('--allowedTools');
  });

  it('allows exactly the requested web tools for research', () => {
    const args = buildClaudeCodeArgs({ ...config, effort: 'high' }, 'SYS', ['WebSearch', 'WebFetch']);
    expect(args[args.indexOf('--tools') + 1]).toBe('WebSearch,WebFetch');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('WebSearch,WebFetch');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
  });
});

describe('parseClaudeCodeStream', () => {
  it('collects tool calls and the final result, ignoring noise', () => {
    const stdout = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Searching"},{"type":"tool_use","name":"WebSearch","input":{"query":"india savings survey"}}]}}',
      'not json',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"WebFetch","input":{"url":"https://example.com"}}]}}',
      '{"type":"result","is_error":false,"result":"{\\"leads\\":[]}","total_cost_usd":0.12}',
    ].join('\n');
    const { result, toolCalls } = parseClaudeCodeStream(stdout);
    expect(toolCalls.map((t) => t.name)).toEqual(['WebSearch', 'WebFetch']);
    expect(result?.result).toBe('{"leads":[]}');
    expect(result?.total_cost_usd).toBe(0.12);
  });
});

describe('claudeCodeStreamLineIsProgress', () => {
  it('counts tokens, turns, tool results and the result as progress, never housekeeping', () => {
    expect(claudeCodeStreamLineIsProgress('{"type":"stream_event","event":{"type":"content_block_delta"}}')).toBe(true);
    expect(claudeCodeStreamLineIsProgress('{"type":"assistant","message":{"content":[]}}')).toBe(true);
    expect(claudeCodeStreamLineIsProgress('{"type":"user","message":{"content":[]}}')).toBe(true);
    expect(claudeCodeStreamLineIsProgress('{"type":"result","is_error":false,"result":"x"}')).toBe(true);
    // A request being retried repeats these; they must not keep a stalled call alive.
    expect(claudeCodeStreamLineIsProgress('{"type":"system","subtype":"status","status":"requesting"}')).toBe(false);
    expect(claudeCodeStreamLineIsProgress('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}')).toBe(false);
    expect(claudeCodeStreamLineIsProgress('not json')).toBe(false);
  });
});

describe('renderClaudeCodePrompt', () => {
  it('passes a single user message through and renders repair turns as a transcript', () => {
    expect(renderClaudeCodePrompt([{ role: 'user', content: 'hi' }])).toBe('hi');
    const repair = renderClaudeCodePrompt([
      { role: 'user', content: 'write' },
      { role: 'assistant', content: '{bad' },
      { role: 'user', content: 'fix it' },
    ]);
    expect(repair).toContain('<your_previous_reply>\n{bad\n</your_previous_reply>');
    expect(repair.indexOf('fix it')).toBeGreaterThan(repair.indexOf('{bad'));
  });
});

describe('Blog LLM client with Claude Code', () => {
  const env: Env = {
    databaseUrl: 'x',
    apiPort: 4000,
    apiHost: '127.0.0.1',
    visualAgentEnabled: false,
    gemini: { apiKey: 'g', model: 'gemini-model' },
    claudeCode: config,
  };

  it('tries Claude Code first and never touches HTTP providers when it succeeds', async () => {
    const fetchImpl = vi.fn();
    const runClaudeCode = vi.fn().mockResolvedValue({ text: 'from claude', model: 'opus', costUsd: null, toolCalls: [] });
    const client = createBlogLlmClient(env, logger, { fetchImpl, runClaudeCode });
    const result = await client.complete({ system: 'S', messages: [{ role: 'user', content: 'hi' }], runId: 'r', stepId: 's' });
    expect(result).toEqual({ text: 'from claude', provider: 'claude-code', model: 'opus' });
    expect(runClaudeCode.mock.calls[0]?.[1]).toMatchObject({ system: 'S', prompt: 'hi', tools: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the free-tier chain when the CLI fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'from gemini' } }] }), { status: 200 }));
    const runClaudeCode = vi.fn().mockRejectedValue(new Error('not logged in'));
    const client = createBlogLlmClient(env, logger, { fetchImpl, runClaudeCode });
    const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }], runId: 'r', stepId: 's' });
    expect(result.provider).toBe('gemini');
  });

  it('is never used by the shared client the other agents get', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('down', { status: 500 }));
    const runClaudeCode = vi.fn();
    const client = createFallbackLlmClient(env, logger, { fetchImpl, runClaudeCode });
    await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }], runId: 'r', stepId: 's' })).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(runClaudeCode).not.toHaveBeenCalled();
  });
});
