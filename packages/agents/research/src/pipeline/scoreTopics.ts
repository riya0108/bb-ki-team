import { z } from 'zod';
import type Groq from 'groq-sdk';
import { generateStructured } from '../llm.js';
import type { TopicCluster } from './evaluateRelevance.js';

const ScoredTopicsSchema = z.object({
  topics: z.array(
    z.object({
      index: z.number().int().min(0),
      score: z.number().int().min(0).max(100),
      reason: z.string().min(1),
    }),
  ),
});

export type ScoredTopicDraft = z.infer<typeof ScoredTopicsSchema>;

export async function scoreTopics(
  groq: Groq,
  model: string,
  userQuery: string,
  clusters: TopicCluster,
): Promise<ScoredTopicDraft> {
  const topicList = clusters.topics
    .map((t, i) => `[${i}] ${t.topic}\nSupporting sources: ${String(t.sourceUrls.length)}\nNotes: ${t.relevanceNotes}`)
    .join('\n\n');

  return generateStructured({
    groq,
    model,
    toolName: 'topic_scores',
    schema: ScoredTopicsSchema,
    system:
      'You score research topics from 0-100 on how interesting and worth covering they are for the ' +
      'original request, weighing source count, apparent recency, and how directly the topic answers ' +
      'the request. Give a one-sentence reason per topic. Return exactly one entry per topic in the ' +
      'candidate list, each tagged with its original index from the list.',
    prompt: `Research request: "${userQuery}"\n\nCandidate topics:\n${topicList}`,
  });
}
