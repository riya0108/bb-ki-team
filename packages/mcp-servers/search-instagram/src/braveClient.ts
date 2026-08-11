import { z } from 'zod';

const BraveResultSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  description: z.string().optional().default(''),
  page_age: z.string().optional(),
});

const BraveResponseSchema = z.object({
  web: z
    .object({
      results: z.array(BraveResultSchema).default([]),
    })
    .optional(),
});

export interface InstagramSearchResult {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
}

export interface BraveInstagramClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Searches Instagram's indexed content via Brave's `site:instagram.com`
 * operator — real, autonomous, headless-compatible (unlike vidIQ's
 * Instagram/TikTok outlier tools, which are only reachable from an
 * interactive Claude Code session, not this repo's `apps/worker`). Trade-off:
 * Brave's index has no engagement metrics (likes/views/followers), so
 * instagram-viral-finder judges relevance/momentum from title+snippet text
 * via LLM rather than a real outlier score — see its classifySignals.ts.
 */
export class BraveInstagramClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BraveInstagramClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string, count = 10): Promise<InstagramSearchResult[]> {
    const url = new URL(BRAVE_SEARCH_ENDPOINT);
    url.searchParams.set('q', `site:instagram.com ${query}`);
    url.searchParams.set('count', String(Math.min(Math.max(count, 1), 20)));
    url.searchParams.set('country', 'IN');

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.apiKey,
      },
    });

    const json: unknown = await response.json();

    if (!response.ok) {
      throw new Error(`Brave Search API error ${String(response.status)}: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const parsed = BraveResponseSchema.parse(json);
    return (parsed.web?.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      description: result.description,
      ...(result.page_age ? { publishedAt: result.page_age } : {}),
    }));
  }
}
