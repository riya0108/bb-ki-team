import { z } from 'zod';

const RedditPostDataSchema = z.object({
  title: z.string(),
  permalink: z.string(),
  selftext: z.string().optional().default(''),
  subreddit_name_prefixed: z.string().optional().default(''),
  score: z.number().optional().default(0),
  num_comments: z.number().optional().default(0),
  created_utc: z.number().optional(),
});

const RedditSearchResponseSchema = z.object({
  data: z.object({
    children: z.array(z.object({ data: RedditPostDataSchema })),
  }),
});

const RedditTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

export interface RedditSearchResult {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
}

export interface RedditClientOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

const TOKEN_ENDPOINT = 'https://www.reddit.com/api/v1/access_token';
const SEARCH_ENDPOINT = 'https://oauth.reddit.com/search';
/** Reddit rejects requests without a descriptive, non-generic User-Agent — see their API rules. */
const USER_AGENT = 'ai-company-os:search-reddit:0.1.0 (by /u/ai-company-os-bot)';
/** Refresh the token this many seconds before its actual expiry, to avoid racing a mid-request expiry. */
const TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS = 60;

/**
 * Reddit's official OAuth2 "application-only" (client_credentials) flow —
 * read-only access, no user login required. Deliberately not the
 * unauthenticated `reddit.com/search.json` endpoint: that path is against
 * Reddit's current API terms for anything beyond casual personal use and is
 * rate-limited unpredictably. Community discussion/sentiment signal,
 * classified as `community` evidence (same tier as Hacker News/Instagram) —
 * see evidenceTypeForSource in packages/agents/research-pack.
 */
export class RedditClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;
  private cachedToken?: { value: string; expiresAtMs: number };
  /**
   * The caller (research-pack's search.ts) fires every planned query against
   * every connected source concurrently, so a cold client can have many
   * search() calls in flight at once. Without this, each would see no cached
   * token and independently POST to the token endpoint. Sharing the in-flight
   * request means concurrent callers await the same promise instead.
   */
  private tokenRequest: Promise<string> | undefined;

  constructor(options: RedditClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAtMs > Date.now()) {
      return this.cachedToken.value;
    }
    if (this.tokenRequest) {
      return this.tokenRequest;
    }

    this.tokenRequest = this.requestAccessToken().finally(() => {
      this.tokenRequest = undefined;
    });
    return this.tokenRequest;
  }

  private async requestAccessToken(): Promise<string> {
    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: 'grant_type=client_credentials',
    });

    const json: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`Reddit token request error ${String(response.status)}: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const parsed = RedditTokenResponseSchema.parse(json);
    this.cachedToken = {
      value: parsed.access_token,
      expiresAtMs: Date.now() + (parsed.expires_in - TOKEN_EXPIRY_SAFETY_MARGIN_SECONDS) * 1000,
    };
    return parsed.access_token;
  }

  async search(query: string, count = 10): Promise<RedditSearchResult[]> {
    const token = await this.getAccessToken();

    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set('q', query);
    url.searchParams.set('sort', 'relevance');
    url.searchParams.set('limit', String(Math.min(Math.max(count, 1), 25)));
    url.searchParams.set('raw_json', '1');

    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
    });

    const json: unknown = await response.json();
    if (!response.ok) {
      throw new Error(`Reddit search API error ${String(response.status)}: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const parsed = RedditSearchResponseSchema.parse(json);
    return parsed.data.children.map(({ data: post }) => ({
      title: post.title,
      url: `https://www.reddit.com${post.permalink}`,
      description:
        `${post.subreddit_name_prefixed ? `${post.subreddit_name_prefixed} — ` : ''}${String(post.score)} upvotes, ` +
        `${String(post.num_comments)} comments` +
        (post.selftext ? `. ${post.selftext.slice(0, 200)}` : ''),
      ...(post.created_utc ? { publishedAt: new Date(post.created_utc * 1000).toISOString() } : {}),
    }));
  }
}
