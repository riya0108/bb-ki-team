import { z } from 'zod';

const HnHitSchema = z.object({
  title: z.string().nullable(),
  url: z.string().url().nullable(),
  objectID: z.string(),
  points: z.number().nullable().optional(),
  num_comments: z.number().nullable().optional(),
  created_at: z.string().optional(),
});

const HnSearchResponseSchema = z.object({
  hits: z.array(HnHitSchema),
});

export interface HackerNewsResult {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
}

export interface HackerNewsClientOptions {
  fetchImpl?: typeof fetch;
}

const HN_SEARCH_ENDPOINT = 'https://hn.algolia.com/api/v1/search';

/** Free, zero-auth Algolia-backed search over Hacker News stories — the "what is the tech/finance community reacting to" channel. */
export class HackerNewsClient {
  private readonly fetchImpl: typeof fetch;

  constructor(options: HackerNewsClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string, count = 10): Promise<HackerNewsResult[]> {
    const url = new URL(HN_SEARCH_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('tags', 'story');
    url.searchParams.set('hitsPerPage', String(Math.min(Math.max(count, 1), 50)));

    const response = await this.fetchImpl(url);
    const json: unknown = await response.json();

    if (!response.ok) {
      throw new Error(`Hacker News API error ${String(response.status)}: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const parsed = HnSearchResponseSchema.parse(json);
    return parsed.hits
      .filter((hit): hit is typeof hit & { title: string; url: string } => Boolean(hit.title && hit.url))
      .map((hit) => ({
        title: hit.title,
        url: hit.url,
        description: `${String(hit.points ?? 0)} points, ${String(hit.num_comments ?? 0)} comments on Hacker News`,
        ...(hit.created_at ? { publishedAt: hit.created_at } : {}),
      }));
  }
}
