import { z } from 'zod';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';

const SearchPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().min(1),
        intent: z.string().min(1),
      }),
    )
    .min(1)
    .max(8),
});

export type SearchPlan = z.infer<typeof SearchPlanSchema>;

/**
 * Unlike the Topic Finder's planSearchQueries (broad topic discovery), this
 * plans queries for a deep dive into ONE already-approved topic — the plan's
 * "investigate primary sources, statistics, expert opinions, counterarguments,
 * examples, case studies" list (§7).
 */
export async function planDeepQueries(
  providers: LlmProviderConfig[],
  topic: string,
  angle: string,
  modificationNote?: string,
): Promise<SearchPlan> {
  return generateStructured({
    providers,
    toolName: 'deep_search_plan',
    schema: SearchPlanSchema,
    system:
      'You plan web search queries for a research agent doing a deep investigation of ONE ' +
      'already-chosen blog topic — not general topic discovery. Produce 4-8 concrete, distinct ' +
      'search engine queries that together surface: supporting statistics or data, expert opinions ' +
      'or authoritative quotes, counterarguments/risks/limitations, and concrete real-world examples ' +
      'or case studies related to the topic. Do not answer the question yourself.',
    prompt:
      `Approved topic: "${topic}"\nAngle: "${angle}"` +
      (modificationNote ? `\nEditor's note: "${modificationNote}"` : '') +
      '\n\nProduce a search plan.',
  });
}
