import { z } from 'zod';
import type { Source } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';

const VerificationSchema = z.object({
  verifications: z.array(
    z.object({
      index: z.number().int().min(0),
      verified: z.boolean(),
      // Not .min(1): an unverified topic still needs *some* text (Groq
      // rejects the whole batch server-side if this schema requires
      // non-empty and the model leaves it blank for verified:false).
      groundedReason: z.string(),
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
  providers: LlmProviderConfig[],
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
    providers,
    toolName: 'topic_verification',
    schema: VerificationSchema,
    system:
      'You fact-check research topic summaries against the source snippets cited for them. Sources are ' +
      'tagged by type — (youtube) snippets are the video\'s title/description/channel only, never the ' +
      'video\'s actual spoken content, so never claim the video "shows" or "demonstrates" something ' +
      'based only on its description. For each topic: rewrite "groundedReason" so it is strictly and ' +
      'only supported by the given snippets (no fabricated or overstated claims), and set verified to ' +
      'false only if no snippet meaningfully supports the topic at all — but even then, groundedReason ' +
      'must still contain a brief non-empty explanation of what is missing, never an empty string. ' +
      'Return exactly one entry per topic, tagged with its original index.',
    prompt: `Verify these topics:\n\n${listing}`,
    maxTokens: 4096,
  });
}
