import { z } from 'zod';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import type { Logger } from '@ai-company/core';
import type { SourceType } from '@ai-company/shared-types';

/**
 * Explicit MCP tool allowlist for this agent's general search sources (plan:
 * "MCP is the tool boundary"). The archive source below has its own, tighter
 * allowlist — never `publish_post`.
 */
const ALLOWED_SEARCH_TOOLS = new Set(['web_search']);
const ALLOWED_ARCHIVE_TOOLS = new Set(['list_archive_posts']);

export const TSX_CLI_PATH_ENV_VAR = 'BLOG_TOPIC_FINDER_AGENT_TSX_CLI_PATH';
/** JSON object mapping search source id -> absolute path of its MCP server entry file. */
export const SEARCH_SERVERS_ENV_VAR = 'BLOG_TOPIC_FINDER_AGENT_SEARCH_SERVERS_JSON';
/** Absolute path of the publish-blog-git MCP server's entry file, for archive reads. */
export const ARCHIVE_SERVER_PATH_ENV_VAR = 'BLOG_TOPIC_FINDER_AGENT_ARCHIVE_SERVER_PATH';

interface SourceDefinition {
  id: SourceType;
  label: string;
  requiredEnvVars: string[];
}

const SOURCE_DEFINITIONS: SourceDefinition[] = [
  { id: 'wikipedia', label: 'Wikipedia', requiredEnvVars: [] },
  { id: 'news', label: 'News (NewsAPI)', requiredEnvVars: ['NEWS_API_KEY'] },
  { id: 'youtube', label: 'YouTube', requiredEnvVars: ['YOUTUBE_API_KEY'] },
  { id: 'competitor', label: 'Competitor blogs (site-scoped search)', requiredEnvVars: ['BRAVE_SEARCH_API_KEY'] },
  { id: 'hackernews', label: 'Hacker News', requiredEnvVars: [] },
];

function resolvedPathFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `blog-topic-finder agent: ${envVar} is not set — the host process must resolve and set this env var before running the agent`,
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

async function connectSource(def: SourceDefinition, entry: string, tsxCli: string): Promise<SearchSource> {
  const client = new Client({ name: `blog-topic-finder-agent-${def.id}`, version: '0.1.0' });
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
      if (!ALLOWED_SEARCH_TOOLS.has(name)) {
        throw new Error(`blog-topic-finder agent: tool "${name}" is outside its MCP allowlist for source "${def.id}"`);
      }
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        const textBlock = result.content.find(
          (block): block is { type: 'text'; text: string } => block.type === 'text',
        );
        throw new Error(`MCP tool "${name}" on source "${def.id}" returned an error: ${textBlock?.text ?? 'unknown error'}`);
      }
      return result.structuredContent ?? result.content;
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Connects to every configured search source (Wikipedia always; the rest
 * only when their API key is present), skipping — not failing on — sources
 * that aren't configured.
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
    throw new Error('blog-topic-finder agent: no search sources are configured — at least Wikipedia must be available');
  }

  return sources;
}

export async function closeSearchSources(sources: SearchSource[]): Promise<void> {
  await Promise.all(sources.map((source) => source.close()));
}

export interface ArchiveMcp {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/** Read-only connection to publish-blog-git for content-DNA/duplicate-detection — never `publish_post`. */
export async function connectArchive(): Promise<ArchiveMcp> {
  const tsxCli = resolvedPathFromEnv(TSX_CLI_PATH_ENV_VAR);
  const serverPath = resolvedPathFromEnv(ARCHIVE_SERVER_PATH_ENV_VAR);

  const client = new Client({ name: 'blog-topic-finder-agent-archive', version: '0.1.0' });
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  const blogRepoPath = process.env.BLOG_REPO_PATH;
  if (blogRepoPath) env.BLOG_REPO_PATH = blogRepoPath;
  const transport = new StdioClientTransport({ command: process.execPath, args: [tsxCli, serverPath], env });
  await client.connect(transport);

  return {
    async callTool(name, args) {
      if (!ALLOWED_ARCHIVE_TOOLS.has(name)) {
        throw new Error(`blog-topic-finder agent: tool "${name}" is outside its archive MCP allowlist`);
      }
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        const textBlock = result.content.find(
          (block): block is { type: 'text'; text: string } => block.type === 'text',
        );
        throw new Error(`MCP tool "${name}" on archive returned an error: ${textBlock?.text ?? 'unknown error'}`);
      }
      return result.structuredContent ?? result.content;
    },
    async close() {
      await client.close();
    },
  };
}
