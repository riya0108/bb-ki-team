import { z } from 'zod';
import type { Logger } from '@ai-company/core';
import type { SourceType } from '@ai-company/shared-types';
import type { SearchSource } from '../mcpClient.js';
import type { SearchPlan } from './planSearchQueries.js';

export interface RawCandidate {
  url: string;
  title: string;
  description: string;
  searchQuery: string;
  sourceType: SourceType;
  publishedAt?: string;
  /** Only populated by the trends (vidIQ) source. */
  platform?: string;
  velocityScore?: number;
}

// Permissive on purpose: web_search sources return {title,url,description,publishedAt?},
// trending_search additionally returns {platform,velocityScore?} — one schema covers both.
const SearchResultOutputSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      description: z.string(),
      publishedAt: z.string().optional(),
      platform: z.string().optional(),
      velocityScore: z.number().min(0).max(100).optional(),
    }),
  ),
});

/**
 * Queries every connected signal source for every planned query, concurrently.
 * A failure on one source/query pair is logged and skipped, never fails the
 * whole run — mirrors packages/agents/research/src/pipeline/search.ts.
 */
export async function gatherSignals(
  sources: SearchSource[],
  plan: SearchPlan,
  logger: Logger,
  resultsPerQuery = 8,
): Promise<RawCandidate[]> {
  const calls = sources.flatMap((source) => plan.queries.map(({ query }) => ({ source, query })));

  const settled = await Promise.allSettled(
    calls.map(async ({ source, query }) => {
      const raw = await source.callTool(source.toolName, { query, count: resultsPerQuery });
      const parsed = SearchResultOutputSchema.parse(raw);
      return { source, query, results: parsed.results };
    }),
  );

  const collected: RawCandidate[] = [];

  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      logger.warn('signal gathering call failed, skipping', {
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
      continue;
    }

    const { source, query, results } = outcome.value;
    logger.info('signal query completed', {
      source: source.id,
      query,
      resultCount: results.length,
    });

    for (const result of results) {
      collected.push({
        url: result.url,
        title: result.title,
        description: result.description,
        searchQuery: query,
        sourceType: source.id,
        ...(result.publishedAt !== undefined ? { publishedAt: result.publishedAt } : {}),
        ...(result.platform !== undefined ? { platform: result.platform } : {}),
        ...(result.velocityScore !== undefined ? { velocityScore: result.velocityScore } : {}),
      });
    }
  }

  return collected;
}
