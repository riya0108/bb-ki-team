import { z } from 'zod';

const YoutubeSearchItemSchema = z.object({
  id: z.object({ videoId: z.string().optional() }).optional(),
  snippet: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
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
}

export interface YoutubeSearchClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

const YOUTUBE_SEARCH_ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';

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
      }));
  }
}
