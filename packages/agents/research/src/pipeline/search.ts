import { z } from 'zod';
import type { Source } from '@ai-company/shared-types';
import type { Logger } from '@ai-company/core';
import type { SearchSource } from '../mcpClient.js';
import type { SearchPlan } from './planSearchQueries.js';

const WebSearchOutputSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      description: z.string(),
      publishedAt: z.string().optional(),
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
      });
    }
  }

  return collected;
}
