import { z } from 'zod';
import type { Source } from '@ai-company/shared-types';
import type { Logger } from '@ai-company/core';
import type { SearchSource } from '../mcpClient.js';
import type { SearchPlan } from './planDeepQueries.js';

const WebSearchOutputSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      description: z.string(),
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
    }),
  ),
});

/**
 * Queries every connected search source for every planned query, concurrently,
 * so total wall-clock time stays close to the slowest single call rather than
 * the sum of all of them. A failure on one source/query pair (rate limit,
 * transient error) is logged and skipped — it never fails the whole run, since
 * the other source/query pairs still contribute useful coverage.
 */
export async function search(
  sources: SearchSource[],
  plan: SearchPlan,
  logger: Logger,
  resultsPerQuery = 8,
): Promise<Source[]> {
  const calls = sources.flatMap((source) =>
    plan.queries.map(({ query }) => ({ source, query })),
  );

  const settled = await Promise.allSettled(
    calls.map(async ({ source, query }) => {
      const raw = await source.callTool('web_search', { query, count: resultsPerQuery });
      const parsed = WebSearchOutputSchema.parse(raw);
      return { source, query, results: parsed.results };
    }),
  );

  const collected: Source[] = [];

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      logger.warn('search call failed, skipping', {
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
      continue;
    }

    const { source, query, results } = outcome.value;
    logger.info('search query completed', { source: source.id, query, resultCount: results.length });

    for (const result of results) {
      collected.push({
        url: result.url,
        title: result.title,
        snippet: result.description,
        searchQuery: query,
        sourceType: source.id,
        ...(result.publishedAt !== undefined ? { publishedAt: result.publishedAt } : {}),
        ...(result.channelId !== undefined ? { channelId: result.channelId } : {}),
      });
    }
  }

  return collected;
}

/**
 * A single broad, short query against one source — used for Hacker News,
 * whose Algolia-backed search needs a short/general query to return
 * anything at all; the long, highly-specific deep-dive queries in a
 * SearchPlan reliably return zero hits there (verified live: a 9-word
 * research query returns 0 hits, the bare topic phrase returns dozens).
 */
export async function searchBroadTopic(
  source: SearchSource,
  topic: string,
  logger: Logger,
  count = 8,
): Promise<Source[]> {
  try {
    const raw = await source.callTool('web_search', { query: topic, count });
    const parsed = WebSearchOutputSchema.parse(raw);
    logger.info('broad topic search completed', { source: source.id, query: topic, resultCount: parsed.results.length });
    return parsed.results.map((result) => ({
      url: result.url,
      title: result.title,
      snippet: result.description,
      searchQuery: topic,
      sourceType: source.id,
      ...(result.publishedAt !== undefined ? { publishedAt: result.publishedAt } : {}),
      ...(result.channelId !== undefined ? { channelId: result.channelId } : {}),
    }));
  } catch (error) {
    logger.warn('broad topic search failed, skipping', {
      source: source.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
