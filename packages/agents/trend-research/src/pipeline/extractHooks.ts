import { z } from 'zod';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import { MomentumStateSchema } from '@ai-company/shared-types';
import type { DedupedCandidate } from './dedupe.js';

const HookSignalsSchema = z.object({
  hooks: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        exampleIndex: z.number().int().min(0),
        momentum: MomentumStateSchema,
        velocityScore: z.number().int().min(0).max(100),
      }),
    )
    .max(4),
});

export type HookSignalsDraft = z.infer<typeof HookSignalsSchema>;

/**
 * Synthesizes "great hooks" — recurring title/opening-line patterns across
 * *multiple* candidates, not a per-item score. This is the one step that
 * looks across the whole candidate set at once rather than scoring items
 * independently (see scoreMomentum.ts), which is why it's a separate step.
 */
export async function extractHooks(
  providers: LlmProviderConfig[],
  topic: string,
  candidates: DedupedCandidate[],
): Promise<HookSignalsDraft> {
  const listing = candidates
    .map((c, i) => `[${i}] (${c.sourceType}) "${c.title}"\nSnippet: ${c.description}`)
    .join('\n\n');

  return generateStructured({
    providers,
    toolName: 'hook_signals',
    schema: HookSignalsSchema,
    system:
      'You analyze titles/openings across many content candidates for a topic to find recurring "hook" ' +
      'patterns — title structures or opening framings that appear to be working right now (e.g. contrarian ' +
      'claims, specific-number promises, question openers, before/after framing). Identify 0-4 genuinely ' +
      'distinct patterns you actually observe repeated or standing out in the given titles — never invent a ' +
      'pattern with no example in the list. For each: give it a short descriptive name (title), explain why ' +
      'it works and how to apply it (description), and set exampleIndex to the single strongest candidate ' +
      'example from the list (its exact index). Estimate momentum/velocityScore for how current the pattern ' +
      'looks based on how many candidates exhibit it.',
    prompt: `Topic/niche: "${topic}"\n\nCandidate titles:\n${listing}`,
    maxTokens: 2048,
  });
}
