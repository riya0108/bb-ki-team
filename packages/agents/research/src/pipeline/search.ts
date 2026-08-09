import { z } from 'zod';
import type { Source } from '@ai-company/shared-types';
import type { Logger } from '@ai-company/core';
import type { ScopedMcpClient } from '../mcpClient.js';
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

export async function search(
  mcpClient: ScopedMcpClient,
  plan: SearchPlan,
  logger: Logger,
  resultsPerQuery = 8,
): Promise<Source[]> {
  const sources: Source[] = [];

  for (const { query } of plan.queries) {
    const raw = await mcpClient.callTool('web_search', { query, count: resultsPerQuery });
    const parsed = WebSearchOutputSchema.parse(raw);
    logger.info('search query completed', { query, resultCount: parsed.results.length });

    for (const result of parsed.results) {
      sources.push({
        url: result.url,
        title: result.title,
        snippet: result.description,
        searchQuery: query,
        ...(result.publishedAt !== undefined ? { publishedAt: result.publishedAt } : {}),
      });
    }
  }

  return sources;
}
