import { describe, expect, it, vi } from 'vitest';
import { RedditClient } from './redditClient.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const TOKEN_BODY = { access_token: 'test-token', expires_in: 3600 };

describe('RedditClient', () => {
  it('fetches an access token once and reuses it across searches', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(TOKEN_BODY))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            children: [
              {
                data: {
                  title: 'Is this stock overvalued?',
                  permalink: '/r/investing/comments/abc123/is_this_stock_overvalued/',
                  selftext: 'Curious what people think.',
                  subreddit_name_prefixed: 'r/investing',
                  score: 42,
                  num_comments: 7,
                  created_utc: 1700000000,
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { children: [] } }),
      );

    const client = new RedditClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });

    const first = await client.search('overvalued stocks');
    expect(first).toEqual([
      {
        title: 'Is this stock overvalued?',
        url: 'https://www.reddit.com/r/investing/comments/abc123/is_this_stock_overvalued/',
        description: 'r/investing — 42 upvotes, 7 comments. Curious what people think.',
        publishedAt: new Date(1700000000 * 1000).toISOString(),
      },
    ]);

    await client.search('overvalued stocks again');

    // 1 token call + 2 search calls, not 2 token calls — the cached token was reused.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const tokenCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('access_token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('shares one in-flight token request across concurrent searches from a cold cache', async () => {
    const fetchImpl = vi.fn().mockImplementation((input: string | URL) => {
      const url = input.toString();
      if (url.includes('access_token')) return Promise.resolve(jsonResponse(TOKEN_BODY));
      return Promise.resolve(jsonResponse({ data: { children: [] } }));
    });
    const client = new RedditClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });

    // research-pack's search.ts fires every planned query against a source concurrently —
    // simulate that shape directly instead of asserting on the private implementation.
    await Promise.all([client.search('a'), client.search('b'), client.search('c')]);

    const tokenCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('access_token'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('throws when the token request fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, false, 401));
    const client = new RedditClient({ clientId: 'id', clientSecret: 'bad-secret', fetchImpl });

    await expect(client.search('anything')).rejects.toThrow(/Reddit token request error 401/);
  });

  it('throws when the search request fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(TOKEN_BODY))
      .mockResolvedValueOnce(jsonResponse({ error: 'rate_limited' }, false, 429));
    const client = new RedditClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });

    await expect(client.search('anything')).rejects.toThrow(/Reddit search API error 429/);
  });
});
