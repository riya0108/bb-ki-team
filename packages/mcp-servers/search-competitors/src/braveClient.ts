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

export interface CompetitorSearchResult {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
}

export interface BraveCompetitorClientOptions {
  apiKey: string;
  /** Domains to scope every search to via a `site:` OR-group — see competitorDomains.ts. */
  domains: string[];
  fetchImpl?: typeof fetch;
}

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Searches only the configured competitor domains via Brave's `site:` OR-group
 * operator — one API call covers every tracked competitor, and (unlike RSS)
 * this searches each site's actual indexed content, not just its last ~10-30
 * posts.
 */
export class BraveCompetitorClient {
  private readonly apiKey: string;
  private readonly siteFilter: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BraveCompetitorClientOptions) {
    this.apiKey = options.apiKey;
    this.siteFilter = `(${options.domains.map((d) => `site:${d}`).join(' OR ')})`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * `freshness` is Brave's recency filter ('pd'/'pw'/'pm'/'py' = past
   * day/week/month/year) — used by fetchCompetitorDigest.ts's recency sweep
   * so it surfaces what competitors have *actually just published*, not
   * just whatever's best-ranked across their entire indexed history.
   */
  async search(query: string, count = 10, freshness?: 'pd' | 'pw' | 'pm' | 'py'): Promise<CompetitorSearchResult[]> {
    const url = new URL(BRAVE_SEARCH_ENDPOINT);
    url.searchParams.set('q', `${this.siteFilter} ${query}`);
    url.searchParams.set('count', String(Math.min(Math.max(count, 1), 20)));
    // These competitor domains are India-focused finance/markets publications.
    url.searchParams.set('country', 'IN');
    if (freshness) url.searchParams.set('freshness', freshness);

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
