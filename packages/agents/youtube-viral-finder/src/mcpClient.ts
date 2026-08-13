import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

/**
 * This agent connects only to search-youtube, and only for these two
 * tools — real YouTube Data API calls, keyed by the existing
 * YOUTUBE_API_KEY, so this agent runs fully headless via the task queue
 * (unlike instagram-viral-finder, which has no equivalent public API).
 */
const ALLOWED_TOOLS = new Set([
  'web_search',
  'get_channel_stats',
  'get_video_stats',
  'list_channel_videos',
  'resolve_channel_handle',
]);

export const TSX_CLI_PATH_ENV_VAR = 'YOUTUBE_VIRAL_FINDER_AGENT_TSX_CLI_PATH';
/** Absolute path of the search-youtube MCP server's entry file. */
export const SERVER_PATH_ENV_VAR = 'YOUTUBE_VIRAL_FINDER_AGENT_SERVER_PATH';

const FORWARDED_ENV_VARS = ['YOUTUBE_API_KEY'];

function resolvedPathFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `youtube-viral-finder agent: ${envVar} is not set — the host process must resolve and set this env var before running the agent`,
    );
  }
  return value;
}

export interface YoutubeMcp {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export async function connectYoutube(): Promise<YoutubeMcp> {
  const tsxCli = resolvedPathFromEnv(TSX_CLI_PATH_ENV_VAR);
  const serverPath = resolvedPathFromEnv(SERVER_PATH_ENV_VAR);

  const client = new Client({ name: 'youtube-viral-finder-agent', version: '0.1.0' });
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const name of FORWARDED_ENV_VARS) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  const transport = new StdioClientTransport({ command: process.execPath, args: [tsxCli, serverPath], env });
  await client.connect(transport);

  return {
    async callTool(name, args) {
      if (!ALLOWED_TOOLS.has(name)) {
        throw new Error(`youtube-viral-finder agent: tool "${name}" is outside its MCP allowlist`);
      }
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) {
        const textBlock = result.content.find(
          (block): block is { type: 'text'; text: string } => block.type === 'text',
        );
        throw new Error(`MCP tool "${name}" returned an error: ${textBlock?.text ?? 'unknown error'}`);
      }
      return result.structuredContent ?? result.content;
    },
    async close() {
      await client.close();
    },
  };
}
