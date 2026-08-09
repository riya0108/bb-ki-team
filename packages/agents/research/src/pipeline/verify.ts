import { z } from 'zod';
import type Groq from 'groq-sdk';
import type { Source } from '@ai-company/shared-types';
import { generateStructured } from '../llm.js';

const VerificationSchema = z.object({
  verifications: z.array(
    z.object({
      index: z.number().int().min(0),
      verified: z.boolean(),
      groundedReason: z.string().min(1),
    }),
  ),
});

export type VerificationResult = z.infer<typeof VerificationSchema>;

export interface TopicToVerify {
  topic: string;
  reason: string;
  sources: Source[];
}

/**
 * Final fact-check gate: rewrites each topic's reason to be strictly
 * grounded in its cited source snippets, and flags topics whose claims
 * aren't actually supported so the orchestrator can drop them. This is the
 * "only valid and correct information" step of the pipeline.
 */
export async function verifyTopics(
  groq: Groq,
  model: string,
  topics: TopicToVerify[],
): Promise<VerificationResult> {
  const listing = topics
    .map(
      (t, i) =>
        `[${i}] Topic: ${t.topic}\nClaimed reason: ${t.reason}\nSource snippets:\n${t.sources
          .map((s) => `- (${s.sourceType}) ${s.title}: ${s.snippet}`)
          .join('\n')}`,
    )
    .join('\n\n');

  return generateStructured({
    groq,
    model,
    toolName: 'topic_verification',
    schema: VerificationSchema,
    system:
      'You fact-check research topic summaries against the source snippets cited for them. Sources are ' +
      'tagged by type — (youtube) snippets are the video\'s title/description/channel only, never the ' +
      'video\'s actual spoken content, so never claim the video "shows" or "demonstrates" something ' +
      'based only on its description. For each topic: rewrite "groundedReason" so it is strictly and ' +
      'only supported by the given snippets (no fabricated or overstated claims), and set verified to ' +
      'false only if no snippet meaningfully supports the topic at all. Return exactly one entry per ' +
      'topic, tagged with its original index.',
    prompt: `Verify these topics:\n\n${listing}`,
    maxTokens: 4096,
  });
}
