import { z } from 'zod';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import type { Logger } from '@ai-company/core';
import type { SourceType } from '@ai-company/shared-types';

/**
 * Explicit MCP tool allowlist for this agent (packages/agents/trend-research).
 * Per CLAUDE.md, agents may only call tools within their declared scope,
 * enforced at the MCP layer — not just by convention — so this is checked
 * on every call, not only at connect time. Deliberately its own allowlist
 * (not shared with packages/agents/research) even though some entries
 * overlap, so each agent's scope stays independently auditable.
 */
const ALLOWED_TOOLS = new Set(['web_search', 'trending_search']);

/**
 * See packages/agents/research/src/mcpClient.ts for why this resolution
 * can't happen inside this module — the host process (this agent's own
 * cli.ts, or apps/worker) must resolve these paths and set them first.
 */
export const TSX_CLI_PATH_ENV_VAR = 'TREND_RESEARCH_AGENT_TSX_CLI_PATH';
/** JSON object mapping search source id -> absolute path of its MCP server entry file. */
export const SEARCH_SERVERS_ENV_VAR = 'TREND_RESEARCH_AGENT_SEARCH_SERVERS_JSON';

interface SourceDefinition {
  id: SourceType;
  label: string;
  /** The MCP tool this source exposes — sources differ (web_search vs trending_search). */
  toolName: string;
  /**
   * Env vars forwarded from the host process into this source's subprocess.
   * If any is missing, the source is skipped rather than failing the whole
   * agent — Wikipedia alone is enough to run on.
   */
  requiredEnvVars: string[];
}

const SOURCE_DEFINITIONS: SourceDefinition[] = [
  { id: 'wikipedia', label: 'Wikipedia', toolName: 'web_search', requiredEnvVars: [] },
  {
    id: 'news',
    label: 'News (NewsAPI)',
    toolName: 'web_search',
    requiredEnvVars: ['NEWS_API_KEY'],
  },
  {
    id: 'trends',
    label: 'Trends (vidIQ)',
    toolName: 'trending_search',
    requiredEnvVars: ['VIDIQ_API_KEY'],
  },
  {
    id: 'competitor',
    label: 'Competitors (site-scoped search)',
    toolName: 'web_search',
    requiredEnvVars: ['BRAVE_SEARCH_API_KEY'],
  },
];

function resolvedPathFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `trend-research agent: ${envVar} is not set — the host process must resolve and set this env var before running the agent`,
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
  toolName: string;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

async function connectSource(
  def: SourceDefinition,
  entry: string,
  tsxCli: string,
): Promise<SearchSource> {
  const client = new Client({ name: `trend-research-agent-${def.id}`, version: '0.1.0' });
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const name of def.requiredEnvVars) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsxCli, entry],
    env,
  });
  await client.connect(transport);

  return {
    id: def.id,
    label: def.label,
    toolName: def.toolName,
    async callTool(name, args) {
      if (!ALLOWED_TOOLS.has(name)) {
        throw new Error(
          `trend-research agent: tool "${name}" is outside its MCP allowlist for source "${def.id}"`,
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
 * Connects to every configured signal source (Wikipedia always; News/Trends/
 * Competitors only when their env vars are present), skipping — not
 * failing on — sources that aren't configured. At least one source
 * (Wikipedia) is always usable.
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
      logger.warn('search source missing required env vars, skipping', {
        source: def.id,
        missingEnv,
      });
      continue;
    }
    sources.push(await connectSource(def, entry, tsxCli));
  }

  if (sources.length === 0) {
    throw new Error(
      'trend-research agent: no search sources are configured — at least Wikipedia must be available',
    );
  }

  return sources;
}

export async function closeSearchSources(sources: SearchSource[]): Promise<void> {
  await Promise.all(sources.map((source) => source.close()));
}
