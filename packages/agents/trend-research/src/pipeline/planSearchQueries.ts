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
    .max(6),
});

export type SearchPlan = z.infer<typeof SearchPlanSchema>;

export async function planSearchQueries(
  providers: LlmProviderConfig[],
  topic: string,
): Promise<SearchPlan> {
  return generateStructured({
    providers,
    toolName: 'trend_search_plan',
    schema: SearchPlanSchema,
    system:
      'You plan search queries for a trend-scouting agent whose job is to find what is breaking out around ' +
      'a topic/niche before it peaks: rising formats, competitor posts getting outsized traction, and ' +
      'title/opening-line patterns ("hooks") that are working right now. Given the topic, produce 3-6 ' +
      'concrete, distinct queries that together surface breakout content, competitor activity, and viral ' +
      'framing/format patterns — not just background information on the topic itself. Each query should ' +
      'target a different angle. Do not answer the question yourself.',
    prompt: `Topic/niche: "${topic}"\n\nProduce a search plan.`,
  });
}
