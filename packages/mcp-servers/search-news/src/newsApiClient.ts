import { z } from 'zod';

const NewsArticleSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  description: z.string().optional().nullable(),
  publishedAt: z.string().optional().nullable(),
  source: z.object({ name: z.string().optional().nullable() }).optional(),
});

const NewsApiOkSchema = z.object({
  status: z.literal('ok'),
  articles: z.array(NewsArticleSchema).default([]),
});

const NewsApiErrorSchema = z.object({
  status: z.literal('error'),
  code: z.string().optional(),
  message: z.string().optional(),
});

export interface NewsSearchResult {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
}

export interface NewsApiClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

const NEWS_API_ENDPOINT = 'https://newsapi.org/v2/everything';

export class NewsApiClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NewsApiClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string, count = 10): Promise<NewsSearchResult[]> {
    const url = new URL(NEWS_API_ENDPOINT);
    url.searchParams.set('q', query);
    url.searchParams.set('language', 'en');
    url.searchParams.set('sortBy', 'relevancy');
    url.searchParams.set('pageSize', String(Math.min(Math.max(count, 1), 100)));

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': this.apiKey,
      },
    });

    const json: unknown = await response.json();

    if (!response.ok) {
      const parsedError = NewsApiErrorSchema.safeParse(json);
      const message = parsedError.success ? (parsedError.data.message ?? parsedError.data.code) : undefined;
      throw new Error(`NewsAPI error ${String(response.status)}: ${message ?? JSON.stringify(json).slice(0, 300)}`);
    }

    const parsed = NewsApiOkSchema.parse(json);
    return parsed.articles.map((article) => ({
      title: article.title,
      url: article.url,
      description: article.description ?? '',
      ...(article.publishedAt ? { publishedAt: article.publishedAt } : {}),
    }));
  }
}
