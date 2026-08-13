import { z } from 'zod';

const YoutubeSearchItemSchema = z.object({
  id: z.object({ videoId: z.string().optional() }).optional(),
  snippet: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    channelId: z.string().optional(),
    channelTitle: z.string().optional(),
    publishedAt: z.string().optional(),
  }),
});

const YoutubeSearchResponseSchema = z.object({
  items: z.array(YoutubeSearchItemSchema).default([]),
});

const YoutubeErrorResponseSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
  }),
});

export interface YoutubeSearchResult {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
  channelId?: string;
}

export interface YoutubeSearchClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_CHANNELS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';
const YOUTUBE_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';

const VideoStatsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        statistics: z.object({
          viewCount: z.string().optional(),
          likeCount: z.string().optional(),
          commentCount: z.string().optional(),
        }),
      }),
    )
    .default([]),
});

export interface VideoStats {
  videoId: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
}

const ChannelsResponseSchema = z.object({
  items: z
    .array(z.object({ id: z.string(), snippet: z.object({ title: z.string() }) }))
    .default([]),
});

const ChannelStatsResponseSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        statistics: z.object({
          subscriberCount: z.string().optional(),
          viewCount: z.string().optional(),
          hiddenSubscriberCount: z.boolean().optional(),
        }),
      }),
    )
    .default([]),
});

export interface ChannelStats {
  channelId: string;
  /** Absent when the channel has hidden its subscriber count. */
  subscriberCount?: number;
  viewCount?: number;
}

export class YoutubeSearchClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: YoutubeSearchClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string, count = 10): Promise<YoutubeSearchResult[]> {
    const url = new URL(YOUTUBE_SEARCH_ENDPOINT);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.min(Math.max(count, 1), 50)));

    const response = await this.fetchImpl(url);
    const json: unknown = await response.json();

    if (!response.ok) {
      const parsedError = YoutubeErrorResponseSchema.safeParse(json);
      const message = parsedError.success ? parsedError.data.error.message : undefined;
      throw new Error(
        `YouTube Data API error ${String(response.status)}: ${message ?? JSON.stringify(json).slice(0, 300)}`,
      );
    }

    const parsed = YoutubeSearchResponseSchema.parse(json);
    return parsed.items
      .filter((item): item is typeof item & { id: { videoId: string } } => Boolean(item.id?.videoId))
      .map((item) => ({
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        description: item.snippet.channelTitle
          ? `${item.snippet.description} (${item.snippet.channelTitle})`
          : item.snippet.description,
        ...(item.snippet.publishedAt ? { publishedAt: item.snippet.publishedAt } : {}),
        ...(item.snippet.channelId ? { channelId: item.snippet.channelId } : {}),
      }));
  }

  /**
   * Lists a channel's actual recent uploads, newest first — unlike `search`,
   * this isn't keyword-driven, so it surfaces what a tracked competitor
   * channel has genuinely just posted rather than whatever a guessed query
   * happens to match.
   */
  async listChannelVideos(channelId: string, count = 8): Promise<YoutubeSearchResult[]> {
    const url = new URL(YOUTUBE_SEARCH_ENDPOINT);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('channelId', channelId);
    url.searchParams.set('order', 'date');
    url.searchParams.set('maxResults', String(Math.min(Math.max(count, 1), 50)));

    const response = await this.fetchImpl(url);
    const json: unknown = await response.json();

    if (!response.ok) {
      const parsedError = YoutubeErrorResponseSchema.safeParse(json);
      const message = parsedError.success ? parsedError.data.error.message : undefined;
      throw new Error(
        `YouTube Data API error ${String(response.status)}: ${message ?? JSON.stringify(json).slice(0, 300)}`,
      );
    }

    const parsed = YoutubeSearchResponseSchema.parse(json);
    return parsed.items
      .filter((item): item is typeof item & { id: { videoId: string } } => Boolean(item.id?.videoId))
      .map((item) => ({
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        description: item.snippet.channelTitle
          ? `${item.snippet.description} (${item.snippet.channelTitle})`
          : item.snippet.description,
        ...(item.snippet.publishedAt ? { publishedAt: item.snippet.publishedAt } : {}),
        channelId,
      }));
  }

  /** Resolves an `@handle` to its channel ID — used to build the tracked-competitor channel list. */
  async resolveHandle(handle: string): Promise<{ channelId: string; title: string } | undefined> {
    const url = new URL(YOUTUBE_CHANNELS_ENDPOINT);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('part', 'id,snippet');
    url.searchParams.set('forHandle', handle);

    const response = await this.fetchImpl(url);
    const json: unknown = await response.json();

    if (!response.ok) {
      const parsedError = YoutubeErrorResponseSchema.safeParse(json);
      const message = parsedError.success ? parsedError.data.error.message : undefined;
      throw new Error(
        `YouTube Data API error ${String(response.status)}: ${message ?? JSON.stringify(json).slice(0, 300)}`,
      );
    }

    const parsed = ChannelsResponseSchema.parse(json);
    const first = parsed.items[0];
    return first ? { channelId: first.id, title: first.snippet.title } : undefined;
  }

  /**
   * Batched subscriber/view counts for up to 50 channel IDs per call — lets
   * youtube-viral-finder compute a subscriber-normalized outlier score
   * (a 100K-view video from a 20K-subscriber channel is a much stronger
   * signal than the same views from a 20M-subscriber channel).
   */
  async getChannelStats(channelIds: string[]): Promise<ChannelStats[]> {
    const uniqueIds = [...new Set(channelIds)].slice(0, 50);
    if (uniqueIds.length === 0) return [];

    const url = new URL(YOUTUBE_CHANNELS_ENDPOINT);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', uniqueIds.join(','));

    const response = await this.fetchImpl(url);
    const json: unknown = await response.json();

    if (!response.ok) {
      const parsedError = YoutubeErrorResponseSchema.safeParse(json);
      const message = parsedError.success ? parsedError.data.error.message : undefined;
      throw new Error(
        `YouTube Data API error ${String(response.status)}: ${message ?? JSON.stringify(json).slice(0, 300)}`,
      );
    }

    const parsed = ChannelStatsResponseSchema.parse(json);
    return parsed.items.map((item) => ({
      channelId: item.id,
      ...(item.statistics.hiddenSubscriberCount
        ? {}
        : item.statistics.subscriberCount !== undefined
          ? { subscriberCount: Number(item.statistics.subscriberCount) }
          : {}),
      ...(item.statistics.viewCount !== undefined ? { viewCount: Number(item.statistics.viewCount) } : {}),
    }));
  }

  /** Batched per-video view/like/comment counts for up to 50 video IDs — search.list doesn't include statistics. */
  async getVideoStats(videoIds: string[]): Promise<VideoStats[]> {
    const uniqueIds = [...new Set(videoIds)].slice(0, 50);
    if (uniqueIds.length === 0) return [];

    const url = new URL(YOUTUBE_VIDEOS_ENDPOINT);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', uniqueIds.join(','));

    const response = await this.fetchImpl(url);
    const json: unknown = await response.json();

    if (!response.ok) {
      const parsedError = YoutubeErrorResponseSchema.safeParse(json);
      const message = parsedError.success ? parsedError.data.error.message : undefined;
      throw new Error(
        `YouTube Data API error ${String(response.status)}: ${message ?? JSON.stringify(json).slice(0, 300)}`,
      );
    }

    const parsed = VideoStatsResponseSchema.parse(json);
    return parsed.items.map((item) => ({
      videoId: item.id,
      ...(item.statistics.viewCount !== undefined ? { viewCount: Number(item.statistics.viewCount) } : {}),
      ...(item.statistics.likeCount !== undefined ? { likeCount: Number(item.statistics.likeCount) } : {}),
      ...(item.statistics.commentCount !== undefined ? { commentCount: Number(item.statistics.commentCount) } : {}),
    }));
  }
}
