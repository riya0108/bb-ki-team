import { z } from 'zod';

const WikipediaPageSchema = z.object({
  key: z.string(),
  title: z.string(),
  excerpt: z.string().optional().default(''),
  description: z.string().optional().nullable(),
});

const WikipediaResponseSchema = z.object({
  pages: z.array(WikipediaPageSchema).default([]),
});

export interface WikipediaSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface WikipediaSearchClientOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

const WIKIPEDIA_SEARCH_ENDPOINT = 'https://en.wikipedia.org/w/rest.php/v1/search/page';

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

export class WikipediaSearchClient {
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: WikipediaSearchClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    // Wikimedia's API etiquette requires a descriptive User-Agent identifying the client.
    this.userAgent = options.userAgent ?? 'ai-company-os-research-agent/0.1 (local development)';
  }

  async search(query: string, limit = 10): Promise<WikipediaSearchResult[]> {
    const url = new URL(WIKIPEDIA_SEARCH_ENDPOINT);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 20)));

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Wikipedia search API error ${String(response.status)}: ${body.slice(0, 300)}`);
    }

    const json: unknown = await response.json();
    const parsed = WikipediaResponseSchema.parse(json);
    return parsed.pages.map((page) => {
      const excerpt = stripHtml(page.excerpt);
      return {
        title: page.title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
        description: excerpt.length > 0 ? excerpt : (page.description ?? ''),
      };
    });
  }
}
