import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createLogger, loadEnv } from '@ai-company/core';
import { YoutubeSearchClient } from './youtubeClient.js';

const env = loadEnv(
  z.object({
    YOUTUBE_API_KEY: z.string().min(1, 'YOUTUBE_API_KEY is required to run the search-youtube MCP server'),
  }),
);

// stdout is the JSON-RPC channel for the stdio transport — all logging must go to stderr.
const logger = createLogger({ runId: 'mcp-search-youtube' }, process.stderr);

const youtubeClient = new YoutubeSearchClient({ apiKey: env.YOUTUBE_API_KEY });

const server = new McpServer({ name: 'search-youtube', version: '0.1.0' });

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
    title: 'Video Search (YouTube)',
    description:
      'Search YouTube videos via the YouTube Data API and return titles, URLs, and descriptions. ' +
      'Metadata only (title/description/channel) — not a transcript of the video content.',
    inputSchema: WebSearchInput,
    outputSchema: WebSearchOutput,
  },
  async ({ query, count }) => {
    try {
      const results = await youtubeClient.search(query, count ?? 10);
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
logger.info('search-youtube MCP server listening on stdio');
