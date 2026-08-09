import { z } from 'zod';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import type { Logger } from '@ai-company/core';
import type { SourceType } from '@ai-company/shared-types';

/**
 * Explicit MCP tool allowlist for this agent (packages/agents/research). Per
 * CLAUDE.md, agents may only call tools within their declared scope, enforced
 * at the MCP layer — not just by convention — so this is checked on every
 * call, not only at connect time.
 */
const ALLOWED_TOOLS = new Set(['web_search']);

/**
 * The host process (the CLI, or the dashboard's next.config.ts) must resolve
 * these paths via require.resolve and set them before calling
 * runResearchAgent. Resolution can't happen inside this module itself:
 * bundlers (webpack/Next.js) statically trace any require.resolve /
 * import.meta.resolve call they find, and both `tsx` and its `esbuild`
 * dependency break when a bundler tries to trace/bundle them. Doing the
 * resolution only in never-bundled entry-point code sidesteps that entirely.
 */
export const TSX_CLI_PATH_ENV_VAR = 'RESEARCH_AGENT_TSX_CLI_PATH';
/** JSON object mapping search source id -> absolute path of its MCP server entry file. */
export const SEARCH_SERVERS_ENV_VAR = 'RESEARCH_AGENT_SEARCH_SERVERS_JSON';

interface SourceDefinition {
  id: SourceType;
  label: string;
  /**
   * Env vars forwarded from the host process into this source's subprocess
   * (e.g. its API key). If any is missing, the source is skipped rather than
   * failing the whole agent — Wikipedia alone is enough to run on.
   */
  requiredEnvVars: string[];
}

const SOURCE_DEFINITIONS: SourceDefinition[] = [
  { id: 'wikipedia', label: 'Wikipedia', requiredEnvVars: [] },
  { id: 'news', label: 'News (NewsAPI)', requiredEnvVars: ['NEWS_API_KEY'] },
  { id: 'youtube', label: 'YouTube', requiredEnvVars: ['YOUTUBE_API_KEY'] },
];

function resolvedPathFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `research agent: ${envVar} is not set — the host process must resolve and set this env var before running the agent`,
    );
  }
  return value;
}

function parseServerEntries(): Partial<Record<SourceType, string>> {
  const raw = resolvedPathFromEnv(SEARCH_SERVERS_ENV_VAR);
  return z.record(z.string(), z.string()).parse(JSON.parse(raw));
}

export interface SearchSource {
  id: SourceType;
  label: string;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

async function connectSource(
  def: SourceDefinition,
  entry: string,
  tsxCli: string,
): Promise<SearchSource> {
  const client = new Client({ name: `research-agent-${def.id}`, version: '0.1.0' });
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const name of def.requiredEnvVars) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  const transport = new StdioClientTransport({ command: process.execPath, args: [tsxCli, entry], env });
  await client.connect(transport);

  return {
    id: def.id,
    label: def.label,
    async callTool(name, args) {
      if (!ALLOWED_TOOLS.has(name)) {
        throw new Error(
          `research agent: tool "${name}" is outside its MCP allowlist for source "${def.id}"`,
        );
      }
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        const textBlock = result.content.find(
          (block): block is { type: 'text'; text: string } => block.type === 'text',
        );
        throw new Error(
          `MCP tool "${name}" on source "${def.id}" returned an error: ${textBlock?.text ?? 'unknown error'}`,
        );
      }
      return result.structuredContent ?? result.content;
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Connects to every configured search source (Wikipedia always; News/YouTube
 * only when their API key is present), skipping — not failing on — sources
 * that aren't configured. At least one source (Wikipedia) is always usable.
 */
export async function connectSearchSources(logger: Logger): Promise<SearchSource[]> {
  const tsxCli = resolvedPathFromEnv(TSX_CLI_PATH_ENV_VAR);
  const serverEntries = parseServerEntries();
  const sources: SearchSource[] = [];

  for (const def of SOURCE_DEFINITIONS) {
    const entry = serverEntries[def.id];
    if (!entry) {
      logger.warn('search source has no server entry configured, skipping', { source: def.id });
      continue;
    }
    const missingEnv = def.requiredEnvVars.filter((name) => !process.env[name]);
    if (missingEnv.length > 0) {
      logger.warn('search source missing required env vars, skipping', { source: def.id, missingEnv });
      continue;
    }
    sources.push(await connectSource(def, entry, tsxCli));
  }

  if (sources.length === 0) {
    throw new Error('research agent: no search sources are configured — at least Wikipedia must be available');
  }

  return sources;
}

export async function closeSearchSources(sources: SearchSource[]): Promise<void> {
  await Promise.all(sources.map((source) => source.close()));
}
