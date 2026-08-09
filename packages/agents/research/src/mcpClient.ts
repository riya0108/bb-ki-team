import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

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
export const SEARCH_SERVER_ENTRY_ENV_VAR = 'RESEARCH_AGENT_SEARCH_SERVER_ENTRY';

function resolvedPathFromEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(
      `research agent: ${envVar} is not set — the host process must resolve and set this env var before running the agent`,
    );
  }
  return value;
}

export interface ScopedMcpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export async function connectSearchClient(): Promise<ScopedMcpClient> {
  const client = new Client({ name: 'research-agent', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolvedPathFromEnv(TSX_CLI_PATH_ENV_VAR), resolvedPathFromEnv(SEARCH_SERVER_ENTRY_ENV_VAR)],
    env: getDefaultEnvironment(),
  });

  await client.connect(transport);

  return {
    async callTool(name, args) {
      if (!ALLOWED_TOOLS.has(name)) {
        throw new Error(
          `research agent: tool "${name}" is outside its MCP allowlist (${[...ALLOWED_TOOLS].join(', ')})`,
        );
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
