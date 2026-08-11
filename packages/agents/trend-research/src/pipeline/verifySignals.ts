import { z } from 'zod';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import type { TrendSignalType } from '@ai-company/shared-types';

export interface SignalDraft {
  type: TrendSignalType;
  title: string;
  description: string;
  evidenceUrl: string;
  evidenceSnippet: string;
}

const VerificationSchema = z.object({
  verifications: z.array(
    z.object({
      index: z.number().int().min(0),
      verified: z.boolean(),
      // Not .min(1): an unverified signal still needs *some* text (Groq
      // rejects the whole batch server-side if this schema requires
      // non-empty and the model leaves it blank for verified:false).
      groundedDescription: z.string(),
    }),
  ),
});

export type SignalVerification = z.infer<typeof VerificationSchema>;

/**
 * Final fact-check gate, mirroring packages/agents/research/src/pipeline/
 * verify.ts: rewrites each signal's description to be strictly grounded in
 * its cited evidence snippet, and flags any that aren't actually supported
 * so the orchestrator can drop them — no unsourced claims presented as fact.
 */
export async function verifySignals(
  providers: LlmProviderConfig[],
  drafts: SignalDraft[],
): Promise<SignalVerification> {
  const listing = drafts
    .map(
      (d, i) =>
        `[${i}] Type: ${d.type}\nTitle: ${d.title}\nClaimed description: ${d.description}\nEvidence snippet: ${d.evidenceSnippet}`,
    )
    .join('\n\n');

  return generateStructured({
    providers,
    toolName: 'signal_verification',
    schema: VerificationSchema,
    system:
      'You fact-check trend-signal descriptions against the evidence snippet cited for each. For each signal: ' +
      'rewrite "groundedDescription" so it is strictly and only supported by the given snippet (no fabricated ' +
      'or overstated claims about performance, virality, or causation the snippet does not actually show), ' +
      'and set verified to false only if the snippet does not meaningfully support the signal at all — but ' +
      'even then, groundedDescription must still contain a brief non-empty explanation of what is missing, ' +
      'never an empty string. Return exactly one entry per signal, tagged with its original index.',
    prompt: `Verify these trend signals:\n\n${listing}`,
    maxTokens: 4096,
  });
}
