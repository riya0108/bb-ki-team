import { z } from 'zod';
import { ScoreBreakdownSchema, type ArchivePost } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import type { CandidateDraft } from './generateCandidates.js';

const ScoredCandidateSchema = z.object({
  index: z.number().int().min(0),
  scoreBreakdown: ScoreBreakdownSchema,
  reason: z.string().min(1),
  risk: z.string().min(1),
  internalLinkCandidates: z.array(z.string().min(1)).default([]),
});
const ScoredCandidatesSchema = z.object({ scored: z.array(ScoredCandidateSchema) });
export type ScoredCandidateDraft = z.infer<typeof ScoredCandidateSchema>;

function formatCandidateListing(candidates: CandidateDraft[]): string {
  return candidates
    .map(
      (c, i) =>
        `[${i}] "${c.topic}" (${c.category})\nAngle: ${c.angle}\nWhy now: ${c.whyNow}\n` +
        `Trend lifecycle: ${c.trendLifecycle} | Overlap: ${c.overlapStatus}\nContent gap: ${c.contentGapNote}`,
    )
    .join('\n\n');
}

/**
 * The plan's 12-factor weighted rubric (§32/§33): the LLM supplies each
 * 0-100 subscore plus qualitative reason/risk text — the caller (index.ts)
 * computes the weighted total deterministically via computeWeightedTotal,
 * never trusting an LLM-stated total directly.
 */
export async function scoreCandidates(
  providers: LlmProviderConfig[],
  candidates: CandidateDraft[],
  archivePosts: ArchivePost[],
): Promise<ScoredCandidateDraft[]> {
  // Keeps the prompt within smaller LLM providers' token-per-minute limits — see index.ts's MAX_SOURCES_FOR_GENERATION.
  const archiveTitles = archivePosts.slice(0, 25).map((p) => p.title);
  const listing = formatCandidateListing(candidates);

  const { scored } = await generateStructured({
    providers,
    toolName: 'candidate_scores',
    schema: ScoredCandidatesSchema,
    system:
      'You score each candidate blog topic on 12 factors, each 0-100: audienceRelevance (fit for ' +
      'Indian Gen Z / young professionals), trendVelocity (is interest accelerating right now, not just ' +
      'high), searchOpportunity (real demand vs realistic competition — a smaller, faster-growing ' +
      'search term can beat a saturated high-volume one), viralPotential (curiosity/emotional intensity/ ' +
      'shareability for a blog, not Instagram-style virality), thoughtProvocation (surprise, ' +
      'counter-intuitive conclusion, hidden consequence — "what if passive investing becomes too ' +
      'popular?" scores far higher than "what is an ETF?"), originality (can this still feel different ' +
      'if 100 other sites cover it), contentGap (how much this fills a gap versus rehashing what ' +
      'competitors already cover), whyNowStrength (how concrete and falsifiable the why-now reasoning ' +
      'is), evergreenValue (deep-dive lasting value vs pure breaking-news), competition (LOWER when ' +
      'existing coverage looks saturated relative to demand — 100 means wide open), internalLinkOpportunity ' +
      '(how many of the archive titles below this candidate could plausibly link to), futurePotential ' +
      '(could this seed a content cluster of 3-5 more articles). For each candidate also give: reason ' +
      '(one sentence, the strongest case for this topic), risk (one honest sentence — what could make ' +
      'this fail or age badly, e.g. rising competitor coverage), and internalLinkCandidates (0-4 exact ' +
      'titles copied verbatim from the archive list below that this article could link to — empty array ' +
      'if none genuinely fit, never invent a title not in the list).',
    prompt: `Archive titles available for internal linking:\n${archiveTitles.join('\n') || '(none)'}\n\nCandidates:\n${listing}`,
    maxTokens: 6144,
  });

  return scored;
}
