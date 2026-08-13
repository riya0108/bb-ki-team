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
  channelId: z.string().optional(),
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

const ResolveHandleInput = z.object({ handle: z.string().min(1) });
const ResolveHandleOutput = z.object({
  channelId: z.string().optional(),
  title: z.string().optional(),
});

server.registerTool(
  'resolve_channel_handle',
  {
    title: 'Resolve YouTube Channel Handle',
    description: 'Resolves an @handle to its channel ID and title — used to build a tracked-competitor channel list.',
    inputSchema: ResolveHandleInput,
    outputSchema: ResolveHandleOutput,
  },
  async ({ handle }) => {
    try {
      const resolved = await youtubeClient.resolveHandle(handle);
      const output = resolved ?? {};
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('resolve_channel_handle failed', { handle, error: message });
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const GetChannelStatsInput = z.object({ channelIds: z.array(z.string().min(1)).min(1).max(50) });
const GetChannelStatsOutput = z.object({
  channels: z.array(
    z.object({
      channelId: z.string(),
      subscriberCount: z.number().optional(),
      viewCount: z.number().optional(),
    }),
  ),
});

server.registerTool(
  'get_channel_stats',
  {
    title: 'Get YouTube Channel Stats',
    description:
      'Batched subscriber/view counts for up to 50 channel IDs — used to compute a subscriber-normalized ' +
      'outlier score (views far exceeding what a channel of that size normally gets).',
    inputSchema: GetChannelStatsInput,
    outputSchema: GetChannelStatsOutput,
  },
  async ({ channelIds }) => {
    try {
      const channels = await youtubeClient.getChannelStats(channelIds);
      const output = { channels };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('get_channel_stats failed', { channelIds, error: message });
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const GetVideoStatsInput = z.object({ videoIds: z.array(z.string().min(1)).min(1).max(50) });
const GetVideoStatsOutput = z.object({
  videos: z.array(
    z.object({
      videoId: z.string(),
      viewCount: z.number().optional(),
      likeCount: z.number().optional(),
      commentCount: z.number().optional(),
    }),
  ),
});

server.registerTool(
  'get_video_stats',
  {
    title: 'Get YouTube Video Stats',
    description:
      'Batched view/like/comment counts for up to 50 video IDs — search results do not include ' +
      'statistics, so this is required to compute a subscriber-normalized outlier score.',
    inputSchema: GetVideoStatsInput,
    outputSchema: GetVideoStatsOutput,
  },
  async ({ videoIds }) => {
    try {
      const videos = await youtubeClient.getVideoStats(videoIds);
      const output = { videos };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('get_video_stats failed', { videoIds, error: message });
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const ListChannelVideosInput = z.object({
  channelIds: z.array(z.string().min(1)).min(1).max(15),
  perChannel: z.number().int().min(1).max(20).optional(),
});
const ListChannelVideosOutput = z.object({
  results: z.array(WebSearchResultItem),
});

server.registerTool(
  'list_channel_videos',
  {
    title: 'List Channel Videos (YouTube)',
    description:
      'Lists actual recent uploads (newest first) for each given channel ID — not a keyword search, so ' +
      'this surfaces what tracked competitor channels have genuinely just posted rather than whatever a ' +
      'guessed query happens to match.',
    inputSchema: ListChannelVideosInput,
    outputSchema: ListChannelVideosOutput,
  },
  async ({ channelIds, perChannel }) => {
    try {
      const settled = await Promise.allSettled(
        channelIds.map((channelId) => youtubeClient.listChannelVideos(channelId, perChannel ?? 8)),
      );
      const results = settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? outcome.value : []));
      const output = { results };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('list_channel_videos failed', { channelIds, error: message });
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
