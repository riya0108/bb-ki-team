import { z } from 'zod';
import type Groq from 'groq-sdk';
import { generateStructured } from '../llm.js';

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
  groq: Groq,
  model: string,
  userQuery: string,
): Promise<SearchPlan> {
  return generateStructured({
    groq,
    model,
    toolName: 'search_plan',
    schema: SearchPlanSchema,
    system:
      'You plan web search queries for a research agent that can be asked about any topic, not just ' +
      'a fixed domain. Given the research request, produce 3-6 concrete, distinct search engine ' +
      'queries that together surface the most interesting, currently relevant angles or subtopics. ' +
      'Each query should target a different angle so results do not overlap. Do not answer the ' +
      'question yourself.',
    prompt: `Research request: "${userQuery}"\n\nProduce a search plan.`,
  });
}
