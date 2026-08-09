import { z } from 'zod';
import type Groq from 'groq-sdk';
import type { Source } from '@ai-company/shared-types';
import { generateStructured } from '../llm.js';

const TopicClusterSchema = z.object({
  topics: z
    .array(
      z.object({
        topic: z.string().min(1),
        sourceUrls: z.array(z.string().url()).min(1),
        relevanceNotes: z.string().min(1),
      }),
    )
    .max(10),
});

export type TopicCluster = z.infer<typeof TopicClusterSchema>;

export async function evaluateRelevance(
  groq: Groq,
  model: string,
  userQuery: string,
  sources: Source[],
): Promise<TopicCluster> {
  const sourceList = sources
    .map((s, i) => `[${i}] (${s.sourceType}) ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}`)
    .join('\n\n');

  return generateStructured({
    groq,
    model,
    toolName: 'topic_clusters',
    schema: TopicClusterSchema,
    system:
      'You group search results into distinct, genuinely relevant topics for a research request. ' +
      'Sources are tagged by type in parentheses — (wikipedia) encyclopedic background, (news) recent ' +
      'articles, (youtube) video metadata/descriptions, not transcripts. Only use source URLs that ' +
      'appear verbatim in the provided list — never invent a URL. Discard sources that are off-topic, ' +
      'low-quality, or purely duplicative of another source. Every topic needs at least one clearly ' +
      'relevant source; merge near-duplicate topics into one.',
    prompt: `Research request: "${userQuery}"\n\nSources:\n${sourceList}\n\nGroup these into relevant topics.`,
    maxTokens: 4096,
  });
}
