import { z } from 'zod';

/** A subscore in the 0-100 range, always paired with the reasoning that produced it — see plan §33 ("don't let the AI just output a score"). */
const scored100 = z.number().int().min(0).max(100);

/**
 * The 12-factor weighted rubric from the user's spec. Weights sum to 98, not
 * 100, in the source spec — `computeWeightedTotal` normalizes against the
 * true sum so `totalScore` still lands on a 0-100 scale rather than silently
 * capping at 98.
 */
export const SCORE_BREAKDOWN_WEIGHTS = {
  audienceRelevance: 15,
  trendVelocity: 12,
  searchOpportunity: 12,
  viralPotential: 10,
  thoughtProvocation: 10,
  originality: 10,
  contentGap: 8,
  whyNowStrength: 7,
  evergreenValue: 5,
  competition: 4,
  internalLinkOpportunity: 3,
  futurePotential: 2,
} as const;

export const ScoreBreakdownSchema = z.object({
  audienceRelevance: scored100,
  trendVelocity: scored100,
  searchOpportunity: scored100,
  viralPotential: scored100,
  thoughtProvocation: scored100,
  originality: scored100,
  contentGap: scored100,
  whyNowStrength: scored100,
  evergreenValue: scored100,
  competition: scored100,
  internalLinkOpportunity: scored100,
  futurePotential: scored100,
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

const TOTAL_WEIGHT = Object.values(SCORE_BREAKDOWN_WEIGHTS).reduce((a, b) => a + b, 0);

/** Code — not the LLM — computes the final weighted total, from LLM-supplied subscores. */
export function computeWeightedTotal(breakdown: ScoreBreakdown): number {
  const sum = (Object.keys(SCORE_BREAKDOWN_WEIGHTS) as (keyof typeof SCORE_BREAKDOWN_WEIGHTS)[]).reduce(
    (acc, key) => acc + breakdown[key] * SCORE_BREAKDOWN_WEIGHTS[key],
    0,
  );
  return Math.round(sum / TOTAL_WEIGHT);
}

export const TitleConceptsSchema = z.object({
  seo: z.string().min(1),
  curiosity: z.string().min(1),
  contrarian: z.string().min(1),
});
export type TitleConcepts = z.infer<typeof TitleConceptsSchema>;

export const TrendLifecycleSchema = z.enum([
  'emerging',
  'accelerating',
  'peak',
  'declining',
  'evergreen',
  'recurring',
  'seasonal',
]);
export type TrendLifecycle = z.infer<typeof TrendLifecycleSchema>;

export const OverlapStatusSchema = z.enum(['new_topic', 'new_angle', 'partially_covered', 'already_covered']);
export type OverlapStatus = z.infer<typeof OverlapStatusSchema>;

/** Cross-platform relevance composite (plan feature #40) — computed by content-strategy, never a hard filter. */
export const CrossPlatformScoreSchema = z.object({
  instagramTrend: scored100,
  youtubeTrend: scored100,
  googleSearch: scored100,
  blogRelevance: scored100,
  deepDivePotential: scored100,
});
export type CrossPlatformScore = z.infer<typeof CrossPlatformScoreSchema>;
