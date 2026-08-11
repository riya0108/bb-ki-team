import { z } from 'zod';

export interface TrendingSearchResult {
  title: string;
  url: string;
  description: string;
  platform: string;
  velocityScore?: number;
  publishedAt?: string;
}

export interface VidiqClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * NOTE: this endpoint path and response shape are a placeholder — vidIQ's
 * partner/developer API access and exact contract were not available to
 * confirm while building this. This client is only ever reached once
 * VIDIQ_API_KEY is set (see mcpClient.ts's requiredEnvVars skip logic in the
 * trend-research agent), so nothing fake ships in the meantime. Before
 * enabling it for real, verify this against vidIQ's actual API docs and
 * update the endpoint/response schema below — it is written to fail loudly
 * (a thrown error surfaced to the caller as an MCP tool error) rather than
 * silently return fabricated data if the real response doesn't match.
 */
const DEFAULT_BASE_URL = 'https://api.vidiq.com';

const VidiqItemSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  description: z.string().optional().default(''),
  platform: z.string().optional().default('youtube'),
  velocityScore: z.number().min(0).max(100).optional(),
  publishedAt: z.string().optional(),
});

const VidiqResponseSchema = z.object({
  items: z.array(VidiqItemSchema).default([]),
});

export class VidiqClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VidiqClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchTrending(query: string, count = 10): Promise<TrendingSearchResult[]> {
    const url = new URL('/trending', this.baseUrl);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(count));

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`vidIQ API error ${String(response.status)}: ${await response.text()}`);
    }

    const json: unknown = await response.json();
    const parsed = VidiqResponseSchema.parse(json);
    return parsed.items.map((item) => ({
      title: item.title,
      url: item.url,
      description: item.description,
      platform: item.platform,
      ...(item.velocityScore !== undefined ? { velocityScore: item.velocityScore } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    }));
  }
}
