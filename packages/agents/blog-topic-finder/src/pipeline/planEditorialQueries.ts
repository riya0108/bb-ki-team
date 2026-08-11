import { z } from 'zod';
import { EDITORIAL_UNIVERSE, type EditorialCategory } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';

const SearchPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().min(1),
        category: z.string().min(1),
        intent: z.string().min(1),
      }),
    )
    .min(4)
    .max(10),
});
export type SearchPlan = z.infer<typeof SearchPlanSchema>;

function formatUniverse(focusCategory: EditorialCategory | undefined): string {
  const profiles = focusCategory
    ? EDITORIAL_UNIVERSE.filter((p) => p.category === focusCategory)
    : EDITORIAL_UNIVERSE;
  return profiles
    .map((p) => `${p.category} (weight ${String(p.weight)}): ${p.subtopics.join(', ')}`)
    .join('\n');
}

/**
 * Plans web-search queries biased toward the editorial universe's weighted
 * categories (plan §3/§4) — higher-weight categories get proportionally more
 * queries — rather than the plain research agent's fully open-ended planning.
 */
export async function planEditorialQueries(
  providers: LlmProviderConfig[],
  focusCategory: EditorialCategory | undefined,
  recentArchiveTopics: string[],
): Promise<SearchPlan> {
  return generateStructured({
    providers,
    toolName: 'editorial_search_plan',
    schema: SearchPlanSchema,
    system:
      'You plan web search queries for a blog Topic Finder scanning a fixed editorial universe of ' +
      'categories (AI, finance, personal finance, business, tech, money, politics, world, lifestyle), ' +
      'each with a relative weight — spend proportionally more queries on higher-weight categories. ' +
      'Produce 4-10 concrete, distinct search-engine queries aimed at surfacing currently interesting, ' +
      'differentiated, deep-dive-worthy developments (not generic explainers) within this universe. Tag ' +
      'each query with the single category it best targets. Avoid queries that would mostly surface ' +
      'topics already covered by this publication (listed below) — look for a new angle or a genuinely ' +
      'new development instead. Do not answer the question yourself.',
    prompt:
      `Editorial universe:\n${formatUniverse(focusCategory)}\n\n` +
      `Recently published topics to avoid rehashing:\n${recentArchiveTopics.slice(0, 30).join('; ') || '(none yet)'}\n\n` +
      'Produce a search plan.',
  });
}
