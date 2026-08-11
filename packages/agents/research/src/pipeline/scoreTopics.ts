import { z } from 'zod';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import type { TopicWithSignals } from './foldTrendSignals.js';

const ScoredTopicsSchema = z.object({
  topics: z.array(
    z.object({
      index: z.number().int().min(0),
      score: z.number().int().min(0).max(100),
      reason: z.string().min(1),
      recommendation: z.string().min(1),
    }),
  ),
});

export type ScoredTopicDraft = z.infer<typeof ScoredTopicsSchema>;

export async function scoreTopics(
  providers: LlmProviderConfig[],
  userQuery: string,
  topics: TopicWithSignals[],
): Promise<ScoredTopicDraft> {
  const topicList = topics
    .map((t, i) => {
      const signalNotes =
        t.supportingSignals.length > 0
          ? t.supportingSignals
              .map((s) => `  - [${s.type}/${s.momentum}, velocity ${String(s.velocityScore)}] ${s.title}: ${s.description}`)
              .join('\n')
          : '  (none)';
      return `[${i}] ${t.topic}\nSupporting sources: ${String(t.sourceUrls.length)}\nNotes: ${t.relevanceNotes}\nTrend signals:\n${signalNotes}`;
    })
    .join('\n\n');

  return generateStructured({
    providers,
    toolName: 'topic_scores',
    schema: ScoredTopicsSchema,
    system:
      'You score research topics from 0-100 on how interesting and worth covering they are for the ' +
      'original request, weighing source count, apparent recency, and how directly the topic answers ' +
      'the request. When a topic has trend signals attached, weigh rising/high-velocity signals as a ' +
      'reason to score higher — they indicate an emerging opportunity, not just background relevance. ' +
      'For every topic, also give "recommendation": one concrete, actionable sentence — a specific angle ' +
      'to take, or (when trend signals are present) a format/hook to use and how urgently, given the ' +
      'signal momentum — never a restatement of the topic. Give a one-sentence reason and one-sentence ' +
      'recommendation per topic. Return exactly one entry per topic in the candidate list, each tagged ' +
      'with its original index.',
    prompt: `Research request: "${userQuery}"\n\nCandidate topics:\n${topicList}`,
    maxTokens: 4096,
  });
}
