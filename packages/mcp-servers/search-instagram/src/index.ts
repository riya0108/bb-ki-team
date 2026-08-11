import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createLogger, loadEnv } from '@ai-company/core';
import { BraveInstagramClient } from './braveClient.js';

const env = loadEnv(
  z.object({
    BRAVE_SEARCH_API_KEY: z
      .string()
      .min(1, 'BRAVE_SEARCH_API_KEY is required to run the search-instagram MCP server'),
  }),
);

// stdout is the JSON-RPC channel for the stdio transport — all logging must go to stderr.
const logger = createLogger({ runId: 'mcp-search-instagram' }, process.stderr);

const instagramClient = new BraveInstagramClient({ apiKey: env.BRAVE_SEARCH_API_KEY });

const server = new McpServer({ name: 'search-instagram', version: '0.1.0' });

const WebSearchInput = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(20).optional(),
});

const WebSearchResultItem = z.object({
  title: z.string(),
  url: z.string().url(),
  description: z.string(),
  publishedAt: z.string().optional(),
});

const WebSearchOutput = z.object({
  results: z.array(WebSearchResultItem),
});

server.registerTool(
  'web_search',
  {
    title: 'Instagram Content Search (Brave, site-scoped)',
    description:
      "Search Instagram's indexed content via Brave Search's `site:instagram.com` operator and return " +
      'titles, URLs, and snippets. No engagement metrics (likes/views/followers) are available this way ' +
      "— only Instagram's own API/vidIQ have those — so relevance and momentum are judged from the text.",
    inputSchema: WebSearchInput,
    outputSchema: WebSearchOutput,
  },
  async ({ query, count }) => {
    try {
      const results = await instagramClient.search(query, count ?? 10);
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
logger.info('search-instagram MCP server listening on stdio');
