import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { ClaudeCodeConfig, ClaudeCodeRunInput, ClaudeCodeRunResult, ClaudeCodeToolCall } from './claudeCode.js';
import { ClaudeCodeError, runClaudeCode } from './claudeCode.js';
import type { Logger } from './logger.js';

// The Blog agent's hosted Claude backend: the Anthropic Messages API with an API key,
// so the deployed apps/api (Render) — and therefore the dashboard from any device —
// gets the same Claude research + writing the local Claude Code CLI gives on the Mac.
//
// It is a drop-in for runClaudeCode: same input, same result shape. Research calls
// get Anthropic's server-side web_search / web_fetch tools (run on Anthropic's side,
// read-only, nothing here executes them); plain completions get no tools at all.
// Every server tool call is surfaced through onToolCall under the Claude Code tool
// names (WebSearch / WebFetch) so the existing research logging and primary-document
// detection work unchanged (CLAUDE.md: every external fetch logged).

export interface AnthropicApiConfig {
  kind: 'anthropic-api';
  apiKey: string;
  // Exact model ID, e.g. "claude-opus-5-5".
  model: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  // Ceiling per call (each continuation request included).
  maxDurationMs?: number;
}

// Either the local CLI (operator's Claude plan) or the hosted API.
export type ClaudeBackendConfig = ClaudeCodeConfig | AnthropicApiConfig;

export function isAnthropicApiConfig(config: ClaudeBackendConfig): config is AnthropicApiConfig {
  return 'kind' in config && config.kind === 'anthropic-api';
}

export function claudeBackendLabel(config: ClaudeBackendConfig): string {
  return isAnthropicApiConfig(config) ? `anthropic-api:${config.model}` : `claude-code:${config.model}`;
}

export const ANTHROPIC_API_DEFAULT_MODEL = 'claude-opus-5-5';
export const ANTHROPIC_API_DEFAULT_EFFORT = 'high';
const DEFAULT_MAX_DURATION_MS = 60 * 60 * 1000;
const MAX_OUTPUT_TOKENS = 64_000;
// A research turn with server tools may pause (stop_reason "pause_turn") and must be
// re-sent to continue; bound how often so a runaway turn can't loop forever.
const MAX_CONTINUATIONS = 8;
// Research breadth caps — generous enough for a sourced long-form article, bounded so
// one article can't run up an open-ended web-tool bill.
const MAX_WEB_SEARCHES = 15;
const MAX_WEB_FETCHES = 20;
const MAX_FETCH_CONTENT_TOKENS = 25_000;

const TOOL_NAME_MAP: Record<string, string> = { web_search: 'WebSearch', web_fetch: 'WebFetch' };

function toolsFor(input: ClaudeCodeRunInput): BetaToolUnion[] {
  const tools: BetaToolUnion[] = [];
  if (input.tools.includes('WebSearch')) {
    tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_WEB_SEARCHES });
  }
  if (input.tools.includes('WebFetch')) {
    tools.push({ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: MAX_WEB_FETCHES, max_content_tokens: MAX_FETCH_CONTENT_TOKENS });
  }
  return tools;
}

const SERVER_TOOL_RESULT_TYPES = new Set(['web_search_tool_result', 'web_fetch_tool_result', 'server_tool_use']);

// The answer is the text written after the last web-tool exchange: narration between
// searches ("Let me look for the RBI circular…") is not part of it — the same thing
// Claude Code's `result` gives the CLI backend.
export function finalAnswerText(blocks: readonly BetaContentBlock[]): string {
  let lastToolIndex = -1;
  blocks.forEach((block, index) => {
    if (SERVER_TOOL_RESULT_TYPES.has(block.type)) lastToolIndex = index;
  });
  return blocks
    .slice(lastToolIndex + 1)
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}

export function serverToolCalls(blocks: readonly BetaContentBlock[]): ClaudeCodeToolCall[] {
  const calls: ClaudeCodeToolCall[] = [];
  for (const block of blocks) {
    if (block.type !== 'server_tool_use') continue;
    calls.push({ name: TOOL_NAME_MAP[block.name] ?? block.name, input: block.input });
  }
  return calls;
}

// Same pacing as the CLI backend: several pipeline steps run concurrently.
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

export type AnthropicMessageStreamer = (
  params: Anthropic.Beta.Messages.MessageCreateParamsStreaming,
  options: { timeout: number },
) => Promise<BetaMessage>;

function defaultStreamer(apiKey: string): AnthropicMessageStreamer {
  // SDK retries 408/409/429/5xx and connection errors itself.
  const client = new Anthropic({ apiKey, maxRetries: 4 });
  return (params, options) => client.beta.messages.stream(params, { timeout: options.timeout }).finalMessage();
}

const streamers = new Map<string, AnthropicMessageStreamer>();
function streamerFor(apiKey: string): AnthropicMessageStreamer {
  let streamer = streamers.get(apiKey);
  if (!streamer) {
    streamer = defaultStreamer(apiKey);
    streamers.set(apiKey, streamer);
  }
  return streamer;
}

export async function runAnthropicApi(
  config: AnthropicApiConfig,
  input: ClaudeCodeRunInput,
  logger: Logger,
  streamer: AnthropicMessageStreamer = streamerFor(config.apiKey),
): Promise<ClaudeCodeRunResult> {
  await acquire();
  try {
    const tools = toolsFor(input);
    const timeout = config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    logger.info({ runId: input.runId, stepId: input.stepId, model: config.model, tools: input.tools }, 'Anthropic API call started');

    const messages: BetaMessageParam[] = [{ role: 'user', content: input.prompt }];
    const turnBlocks: BetaContentBlock[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0, webSearches: 0, webFetches: 0 };
    let last: BetaMessage | null = null;

    for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt += 1) {
      const response = await streamer(
        {
          model: config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          stream: true,
          system: input.system,
          messages,
          thinking: { type: 'adaptive' },
          output_config: { effort: config.effort ?? ANTHROPIC_API_DEFAULT_EFFORT },
          // A safety-classifier decline is retried on a fallback model server-side
          // instead of failing the article.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          ...(tools.length > 0 ? { tools } : {}),
        },
        { timeout },
      );
      last = response;
      turnBlocks.push(...response.content);
      for (const call of serverToolCalls(response.content)) input.onToolCall?.(call);
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;
      usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
      usage.webSearches += response.usage.server_tool_use?.web_search_requests ?? 0;
      usage.webFetches += response.usage.server_tool_use?.web_fetch_requests ?? 0;

      if (response.stop_reason !== 'pause_turn') break;
      // Continue the paused server-tool turn: resend with the partial assistant turn.
      messages.push({ role: 'assistant', content: response.content });
    }

    if (!last) throw new ClaudeCodeError('Anthropic API returned no response');
    if (last.stop_reason === 'refusal') {
      throw new ClaudeCodeError(`Anthropic API declined the request (${last.stop_details?.category ?? 'no category'})`);
    }
    if (last.stop_reason === 'pause_turn') {
      throw new ClaudeCodeError(`Anthropic API research turn did not finish after ${MAX_CONTINUATIONS} continuations`);
    }
    if (last.stop_reason === 'max_tokens') {
      throw new ClaudeCodeError(`Anthropic API output hit the ${MAX_OUTPUT_TOKENS}-token limit`);
    }
    const text = finalAnswerText(turnBlocks);
    if (text.length === 0) throw new ClaudeCodeError(`Anthropic API returned no text (stop_reason ${last.stop_reason ?? 'null'})`);

    const toolCalls = serverToolCalls(turnBlocks);
    logger.info(
      { runId: input.runId, stepId: input.stepId, model: last.model, toolCalls: toolCalls.length, usage },
      'Anthropic API call finished',
    );
    return { text, model: last.model, costUsd: null, toolCalls };
  } catch (error) {
    if (error instanceof ClaudeCodeError) throw error;
    // Typed SDK errors carry the HTTP status; surface it so the fallback log is useful.
    if (error instanceof Anthropic.APIError) {
      throw new ClaudeCodeError(`Anthropic API error ${error.status ?? 'network'}: ${error.message.slice(0, 300)}`);
    }
    throw new ClaudeCodeError(`Anthropic API call failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    release();
  }
}

// One entry point for both backends.
export function runClaude(config: ClaudeBackendConfig, input: ClaudeCodeRunInput, logger: Logger): Promise<ClaudeCodeRunResult> {
  return isAnthropicApiConfig(config) ? runAnthropicApi(config, input, logger) : runClaudeCode(config, input, logger);
}
