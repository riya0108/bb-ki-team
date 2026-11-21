import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import type { Logger } from './logger.js';

// Runs the locally installed Claude Code CLI headlessly (`claude -p`), so the blog
// agent can use the operator's own Claude plan for long-form research and writing
// instead of the free-tier API models (see llm.ts's provider chain).
//
// Safety properties, all enforced here rather than left to each caller:
//  - The child gets a MINIMAL environment (PATH/HOME/locale only). DATABASE_URL, API
//    keys, publish tokens and every other secret in this process's env never reach
//    it (CLAUDE.md: never expose API keys). ANTHROPIC_API_KEY is deliberately not
//    passed either, so the CLI bills the operator's logged-in Claude plan.
//  - It runs in a fresh empty temp directory, so it never reads this repo (no
//    CLAUDE.md, no source files) and has nothing to edit.
//  - Tools are an explicit allowlist per call: none for plain completions, and only
//    WebSearch/WebFetch for research. No MCP servers (--strict-mcp-config), no shell,
//    no file tools — it can read the web, never act on it.
//  - Every tool call it makes is surfaced to the caller (stream-json) so it can be
//    logged with the run's correlation IDs (CLAUDE.md: every external fetch logged).

export interface ClaudeCodeConfig {
  // Model alias or ID passed to `--model` (e.g. "opus", "sonnet").
  model: string;
  // CLI binary; defaults to `claude` on PATH.
  bin?: string;
  // Idle limit: the call is killed only after this long with NO output. The CLI
  // streams partial tokens (--include-partial-messages), so a long article that is
  // still being written keeps resetting it. A fixed 15-minute wall clock killed a
  // healthy Opus draft mid-article in a live run (2026-11-17).
  timeoutMs?: number;
  // Absolute ceiling per call, however much output is flowing.
  maxDurationMs?: number;
  // Optional `--effort` level for models that support it.
  effort?: string;
}

export const CLAUDE_CODE_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const CLAUDE_CODE_DEFAULT_MAX_DURATION_MS = 60 * 60 * 1000;

const PASSTHROUGH_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'CLAUDE_CONFIG_DIR'] as const;

export function claudeCodeChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH_ENV) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export interface ClaudeCodeToolCall {
  name: string;
  input: unknown;
}

export interface ClaudeCodeRunInput {
  system: string;
  prompt: string;
  // Built-in tools the session may use. Empty = none.
  tools: readonly ('WebSearch' | 'WebFetch')[];
  runId: string;
  stepId: string;
  onToolCall?: (call: ClaudeCodeToolCall) => void;
}

export interface ClaudeCodeRunResult {
  text: string;
  model: string;
  costUsd: number | null;
  toolCalls: ClaudeCodeToolCall[];
}

export class ClaudeCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeCodeError';
  }
}

const ResultEventSchema = z.object({
  type: z.literal('result'),
  is_error: z.boolean().default(false),
  result: z.string().optional(),
  subtype: z.string().optional(),
  total_cost_usd: z.number().optional(),
});

const ToolUseBlockSchema = z.object({ type: z.literal('tool_use'), name: z.string(), input: z.unknown() });
const AssistantEventSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({ content: z.array(z.unknown()).default([]) }),
});

export function buildClaudeCodeArgs(config: ClaudeCodeConfig, system: string, tools: readonly string[]): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model',
    config.model,
    '--system-prompt',
    system,
    '--tools',
    tools.join(','),
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (tools.length > 0) args.push('--allowedTools', tools.join(','));
  if (config.effort) args.push('--effort', config.effort);
  return args;
}

type ResultEvent = z.infer<typeof ResultEventSchema>;

// Event types that mean the model is actually making progress: streamed tokens,
// whole assistant turns, tool results coming back, the final result. The CLI also
// emits housekeeping events (system/status "requesting", rate_limit_event) that can
// repeat while a request is being retried — those must NOT keep a stalled call alive.
const PROGRESS_EVENT_TYPES = new Set(['stream_event', 'assistant', 'user', 'result']);

const RateLimitEventSchema = z.object({
  type: z.literal('rate_limit_event'),
  rate_limit_info: z.object({ status: z.string(), rateLimitType: z.string().optional(), resetsAt: z.number().optional() }).passthrough(),
});

interface StreamLine {
  result: ResultEvent | null;
  toolCalls: ClaudeCodeToolCall[];
  progress: boolean;
  // A plan rate-limit state other than "allowed" (e.g. "allowed_warning", "rejected").
  rateLimit: { status: string; type: string | null; resetsAt: string | null } | null;
}

// One line of the CLI's stream-json output (one JSON event per line).
function parseStreamLine(line: string): StreamLine {
  const none: StreamLine = { result: null, toolCalls: [], progress: false, rateLimit: null };
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return none;
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return none;
  }
  const type = typeof event === 'object' && event !== null ? (event as { type?: unknown }).type : undefined;
  const progress = typeof type === 'string' && PROGRESS_EVENT_TYPES.has(type);
  const asRateLimit = RateLimitEventSchema.safeParse(event);
  if (asRateLimit.success) {
    const info = asRateLimit.data.rate_limit_info;
    return info.status === 'allowed'
      ? none
      : {
          ...none,
          rateLimit: {
            status: info.status,
            type: info.rateLimitType ?? null,
            resetsAt: info.resetsAt !== undefined ? new Date(info.resetsAt * 1000).toISOString() : null,
          },
        };
  }
  const asResult = ResultEventSchema.safeParse(event);
  if (asResult.success) return { ...none, result: asResult.data, progress: true };
  const asAssistant = AssistantEventSchema.safeParse(event);
  if (!asAssistant.success) return { ...none, progress };
  const toolCalls: ClaudeCodeToolCall[] = [];
  for (const block of asAssistant.data.message.content) {
    const tool = ToolUseBlockSchema.safeParse(block);
    if (tool.success) toolCalls.push({ name: tool.data.name, input: tool.data.input });
  }
  return { ...none, toolCalls, progress: true };
}

export function claudeCodeStreamLineIsProgress(line: string): boolean {
  return parseStreamLine(line).progress;
}

export function parseClaudeCodeStream(stdout: string): { result: ResultEvent | null; toolCalls: ClaudeCodeToolCall[] } {
  const toolCalls: ClaudeCodeToolCall[] = [];
  let result: ResultEvent | null = null;
  for (const line of stdout.split('\n')) {
    const parsed = parseStreamLine(line);
    toolCalls.push(...parsed.toolCalls);
    result = parsed.result ?? result;
  }
  return { result, toolCalls };
}

// Several pipeline steps run LLM calls concurrently; each `claude -p` is a whole CLI
// process, so cap how many run at once.
const MAX_CONCURRENT = 3;
let active = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
}

function release(): void {
  active -= 1;
  waiting.shift()?.();
}

export async function runClaudeCode(config: ClaudeCodeConfig, input: ClaudeCodeRunInput, logger: Logger): Promise<ClaudeCodeRunResult> {
  await acquire();
  const workdir = await mkdtemp(join(tmpdir(), 'bb-claude-'));
  try {
    const args = buildClaudeCodeArgs(config, input.system, input.tools);
    const timeoutMs = config.timeoutMs ?? CLAUDE_CODE_DEFAULT_TIMEOUT_MS;
    const maxDurationMs = config.maxDurationMs ?? CLAUDE_CODE_DEFAULT_MAX_DURATION_MS;
    logger.info({ runId: input.runId, stepId: input.stepId, model: config.model, tools: input.tools }, 'Claude Code call started');

    const toolCalls: ClaudeCodeToolCall[] = [];
    // Held in an object: TypeScript doesn't track assignments made inside callbacks.
    const state: { result: ResultEvent | null } = { result: null };
    const { stderr, code } = await new Promise<{ stderr: string; code: number | null }>((resolve, reject) => {
      const child = spawn(config.bin ?? 'claude', args, { cwd: workdir, env: claudeCodeChildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      // Only the unfinished last line is buffered; tool results (whole fetched pages)
      // stream through without being kept or re-parsed.
      let pending = '';
      let err = '';
      const timers: { idle?: NodeJS.Timeout; hard?: NodeJS.Timeout } = {};
      const clearTimers = (): void => {
        clearTimeout(timers.idle);
        clearTimeout(timers.hard);
      };
      const fail = (message: string): void => {
        clearTimers();
        child.kill('SIGTERM');
        reject(new ClaudeCodeError(message));
      };
      // Reset on every chunk of output (partial tokens included): only silence kills.
      const stillWorking = (): void => {
        clearTimeout(timers.idle);
        timers.idle = setTimeout(() => fail(`claude -p produced no output for ${Math.round(timeoutMs / 1000)}s`), timeoutMs);
      };
      stillWorking();
      timers.hard = setTimeout(() => fail(`claude -p exceeded ${Math.round(maxDurationMs / 60_000)} minutes`), maxDurationMs);
      const consume = (line: string): void => {
        const parsed = parseStreamLine(line);
        if (parsed.progress) stillWorking();
        if (parsed.rateLimit) {
          logger.warn({ runId: input.runId, stepId: input.stepId, model: config.model, ...parsed.rateLimit }, 'Claude plan rate limit reported');
        }
        state.result = parsed.result ?? state.result;
        for (const call of parsed.toolCalls) {
          toolCalls.push(call);
          input.onToolCall?.(call);
        }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(consume);
      });
      child.stdout.on('end', () => {
        if (pending.length > 0) consume(pending);
        pending = '';
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        err += chunk;
      });
      child.on('error', (error) => {
        clearTimers();
        reject(new ClaudeCodeError(`could not start Claude Code CLI: ${error.message}`));
      });
      child.on('close', (exitCode) => {
        clearTimers();
        resolve({ stderr: err, code: exitCode });
      });
      child.stdin.end(input.prompt);
    });

    const final = state.result;
    if (!final) {
      throw new ClaudeCodeError(`claude -p exited ${code ?? 'without a code'} with no result: ${stderr.slice(0, 500)}`);
    }
    if (final.is_error || typeof final.result !== 'string' || final.result.length === 0) {
      throw new ClaudeCodeError(`claude -p returned an error (${final.subtype ?? 'unknown'}): ${(final.result ?? stderr).slice(0, 500)}`);
    }
    logger.info(
      { runId: input.runId, stepId: input.stepId, model: config.model, toolCalls: toolCalls.length, costUsd: final.total_cost_usd ?? null },
      'Claude Code call finished',
    );
    return { text: final.result, model: config.model, costUsd: final.total_cost_usd ?? null, toolCalls };
  } finally {
    release();
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Plain completion messages -> one prompt. A repair turn (assistant reply + user
// correction) is rendered as an explicit transcript so the model sees its own answer.
export function renderClaudeCodePrompt(messages: readonly { role: 'user' | 'assistant'; content: string }[]): string {
  if (messages.length === 1 && messages[0]?.role === 'user') return messages[0].content;
  return messages
    .map((m) => (m.role === 'user' ? `<user_turn>\n${m.content}\n</user_turn>` : `<your_previous_reply>\n${m.content}\n</your_previous_reply>`))
    .join('\n\n');
}
