import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';

/**
 * Explicit MCP tool allowlist for this agent (packages/agents/research). Per
 * CLAUDE.md, agents may only call tools within their declared scope, enforced
 * at the MCP layer — not just by convention — so this is checked on every
 * call, not only at connect time.
 */
const ALLOWED_TOOLS = new Set(['web_search']);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const searchServerEntry = path.join(repoRoot, 'packages/mcp-servers/search-wikipedia/src/index.ts');

export interface ScopedMcpClient {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export async function connectSearchClient(): Promise<ScopedMcpClient> {
  const client = new Client({ name: 'research-agent', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: tsxBin,
    args: [searchServerEntry],
    cwd: repoRoot,
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
