import { z } from 'zod';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import { MomentumStateSchema } from '@ai-company/shared-types';
import type { DedupedCandidate } from './dedupe.js';

const MomentumScoreSchema = z.object({
  signals: z.array(
    z.object({
      index: z.number().int().min(0),
      type: z.enum(['trending_topic', 'competitor_post', 'format']),
      momentum: MomentumStateSchema,
      velocityScore: z.number().int().min(0).max(100),
      rationale: z.string().min(1),
    }),
  ),
});

export type MomentumScoreDraft = z.infer<typeof MomentumScoreSchema>;

/**
 * Scores each deduped candidate's momentum/velocity and classifies its
 * signal type. Grounded in real (not invented) evidence: mentionCount
 * (independent cross-source/query repetition), recency, and vidIQ's
 * velocityScore hint when the trends source is configured — the model is
 * told explicitly not to assign a high score without one of these backing
 * it up.
 */
export async function scoreMomentum(
  providers: LlmProviderConfig[],
  topic: string,
  candidates: DedupedCandidate[],
): Promise<MomentumScoreDraft> {
  const listing = candidates
    .map((c, i) => {
      const evidence = [
        `mentioned ${String(c.mentionCount)}x across sources/queries`,
        c.publishedAt ? `published ${c.publishedAt}` : 'no publish date',
        c.velocityScore !== undefined
          ? `vidIQ velocity hint: ${String(c.velocityScore)}`
          : undefined,
      ]
        .filter(Boolean)
        .join(', ');
      return `[${i}] (${c.sourceType}${c.platform ? `/${c.platform}` : ''}) ${c.title}\nURL: ${c.url}\nEvidence: ${evidence}\nSnippet: ${c.description}`;
    })
    .join('\n\n');

  return generateStructured({
    providers,
    toolName: 'momentum_scores',
    schema: MomentumScoreSchema,
    system:
      'You score content candidates for a trend-scouting agent tracking a topic/niche. For each candidate, ' +
      'classify its type — "competitor_post" if its source is tagged (competitor), "format" if what stands ' +
      'out is its content structure/style rather than subject matter, otherwise "trending_topic" — and assign ' +
      '"momentum" (rising/peaking/declining) and "velocityScore" 0-100. Base momentum/velocity strictly on the ' +
      'given evidence (mention count, recency, vidIQ velocity hint if present) — do not invent numbers with no ' +
      'backing evidence; when evidence is thin, keep velocityScore low/moderate and say so in the rationale. ' +
      'Return exactly one entry per candidate, tagged with its original index.',
    prompt: `Topic/niche: "${topic}"\n\nCandidates:\n${listing}`,
    maxTokens: 4096,
  });
}
