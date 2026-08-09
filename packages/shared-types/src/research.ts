import { z } from 'zod';

export const SourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  snippet: z.string(),
  searchQuery: z.string().min(1),
  publishedAt: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ScoredTopicSchema = z.object({
  topic: z.string().min(1),
  score: z.number().int().min(0).max(100),
  reason: z.string().min(1),
  sources: z.array(z.string().url()).min(1),
});
export type ScoredTopic = z.infer<typeof ScoredTopicSchema>;

export const ResearchAgentOutputSchema = z.object({
  query: z.string().min(1),
  runId: z.string().min(1),
  generatedAt: z.string(),
  topics: z.array(ScoredTopicSchema),
});
export type ResearchAgentOutput = z.infer<typeof ResearchAgentOutputSchema>;
