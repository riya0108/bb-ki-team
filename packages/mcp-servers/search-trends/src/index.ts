import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createLogger, loadEnv } from '@ai-company/core';
import { VidiqClient } from './vidiqClient.js';

const env = loadEnv(
  z.object({
    VIDIQ_API_KEY: z
      .string()
      .min(1, 'VIDIQ_API_KEY is required to run the search-trends MCP server'),
  }),
);

// stdout is the JSON-RPC channel for the stdio transport — all logging must go to stderr.
const logger = createLogger({ runId: 'mcp-search-trends' }, process.stderr);

const vidiqClient = new VidiqClient({ apiKey: env.VIDIQ_API_KEY });

const server = new McpServer({ name: 'search-trends', version: '0.1.0' });

const TrendingSearchInput = z.object({
  query: z.string().min(1),
  count: z.number().int().min(1).max(20).optional(),
});

const TrendingSearchResultItem = z.object({
  title: z.string(),
  url: z.string().url(),
  description: z.string(),
  platform: z.string(),
  velocityScore: z.number().min(0).max(100).optional(),
  publishedAt: z.string().optional(),
});

const TrendingSearchOutput = z.object({
  results: z.array(TrendingSearchResultItem),
});

server.registerTool(
  'trending_search',
  {
    title: 'Trending Content Search (vidIQ)',
    description:
      'Search for rising/trending content and velocity signals via vidIQ. Output includes platform and ' +
      'velocity metadata, unlike plain web_search — use this to find what is breaking out, not just what ' +
      'is on-topic.',
    inputSchema: TrendingSearchInput,
    outputSchema: TrendingSearchOutput,
  },
  async ({ query, count }) => {
    try {
      const results = await vidiqClient.searchTrending(query, count ?? 10);
      const output = { results };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('trending_search failed', { query, error: message });
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('search-trends MCP server listening on stdio');
