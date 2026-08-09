import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createLogger } from '@ai-company/core';
import { WikipediaSearchClient } from './wikipediaClient.js';

// stdout is the JSON-RPC channel for the stdio transport — all logging must go to stderr.
const logger = createLogger({ runId: 'mcp-search-wikipedia' }, process.stderr);

const wikipediaClient = new WikipediaSearchClient();

const server = new McpServer({ name: 'search-wikipedia', version: '0.1.0' });

const WebSearchInput = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(20).optional(),
});

const WebSearchResultItem = z.object({
  title: z.string(),
  url: z.string().url(),
  description: z.string(),
});

const WebSearchOutput = z.object({
  results: z.array(WebSearchResultItem),
});

server.registerTool(
  'web_search',
  {
    title: 'Web Search (Wikipedia)',
    description:
      'Search Wikipedia articles and return titles, URLs, and snippets. No API key required. ' +
      'Scope is limited to Wikipedia — not general/real-time web search.',
    inputSchema: WebSearchInput,
    outputSchema: WebSearchOutput,
  },
  async ({ query, count }) => {
    try {
      const results = await wikipediaClient.search(query, count ?? 10);
      const output = { results };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('web_search failed', { query, error: message });
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('search-wikipedia MCP server listening on stdio');
