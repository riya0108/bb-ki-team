import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

/**
 * Explicit MCP tool allowlist for this agent (packages/agents/blog-publisher).
 * This is the ONLY agent allowed to touch the blog repo, and even it may
 * only call this one tool — enforced here, not just by convention.
 */
const ALLOWED_TOOLS = new Set(['publish_post']);

/** See packages/agents/research/src/mcpClient.ts for why resolution can't happen inside this module. */
export const TSX_CLI_PATH_ENV_VAR = 'BLOG_PUBLISHER_AGENT_TSX_CLI_PATH';
/** Absolute path of the publish-blog-git MCP server's entry file. */
export const SERVER_PATH_ENV_VAR = 'BLOG_PUBLISHER_AGENT_SERVER_PATH';

/** Forwarded into the MCP server subprocess — this is the only place these are read. */
const FORWARDED_ENV_VARS = ['BLOG_REPO_PATH', 'BLOG_GIT_BRANCH', 'BLOG_PUBLISH_STATUS', 'BLOG_SITE_URL'];

function resolvedPathFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `blog-publisher agent: ${envVar} is not set — the host process must resolve and set this env var before running the agent`,
    );
  }
  return value;
}

export interface BlogGitMcp {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export async function connectBlogGit(): Promise<BlogGitMcp> {
  const tsxCli = resolvedPathFromEnv(TSX_CLI_PATH_ENV_VAR);
  const serverPath = resolvedPathFromEnv(SERVER_PATH_ENV_VAR);

  const client = new Client({ name: 'blog-publisher-agent', version: '0.1.0' });
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
        throw new Error(`blog-publisher agent: tool "${name}" is outside its MCP allowlist`);
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
