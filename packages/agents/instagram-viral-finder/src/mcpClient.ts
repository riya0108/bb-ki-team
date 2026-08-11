import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

/**
 * This agent connects only to search-instagram, and only for `web_search` —
 * a real, autonomous, headless-compatible search engine (Brave, scoped to
 * instagram.com), unlike the earlier vidIQ-paste design this replaced.
 */
const ALLOWED_TOOLS = new Set(['web_search']);

export const TSX_CLI_PATH_ENV_VAR = 'INSTAGRAM_VIRAL_FINDER_AGENT_TSX_CLI_PATH';
/** Absolute path of the search-instagram MCP server's entry file. */
export const SERVER_PATH_ENV_VAR = 'INSTAGRAM_VIRAL_FINDER_AGENT_SERVER_PATH';

const FORWARDED_ENV_VARS = ['BRAVE_SEARCH_API_KEY'];

function resolvedPathFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `instagram-viral-finder agent: ${envVar} is not set — the host process must resolve and set this env var before running the agent`,
    );
  }
  return value;
}

export interface InstagramMcp {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export async function connectInstagram(): Promise<InstagramMcp> {
  const tsxCli = resolvedPathFromEnv(TSX_CLI_PATH_ENV_VAR);
  const serverPath = resolvedPathFromEnv(SERVER_PATH_ENV_VAR);

  const client = new Client({ name: 'instagram-viral-finder-agent', version: '0.1.0' });
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
        throw new Error(`instagram-viral-finder agent: tool "${name}" is outside its MCP allowlist`);
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
