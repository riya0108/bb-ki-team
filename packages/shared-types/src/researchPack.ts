import { z } from 'zod';
import { SourceSchema } from './research.js';

/**
 * How trustworthy/traceable a claim's origin is. `background` is where
 * Wikipedia lands — usable for orientation/definitions/history, never as
 * citation-worthy evidence for a specific fact or statistic. `primary`
 * (official filings, statements) mostly won't be reachable given today's
 * search channels — extraction is expected to honestly land most real hits
 * in `secondary`/`community` rather than mislabel them.
 */
export const EvidenceSourceTypeSchema = z.enum(['primary', 'secondary', 'community', 'background']);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

export const ResearchFactSchema = z.object({
  claim: z.string().min(1),
  /** The specific number/quantity the claim centers on, if any (e.g. "42%", "$6,000"). */
  value: z.string().optional(),
  source: z.string().url(),
  sourceType: EvidenceSourceTypeSchema,
  publishedAt: z.string().optional(),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
});
export type ResearchFact = z.infer<typeof ResearchFactSchema>;

export const ResearchStatisticSchema = z.object({
  stat: z.string().min(1),
  value: z.string().optional(),
  source: z.string().url(),
  sourceType: EvidenceSourceTypeSchema,
  publishedAt: z.string().optional(),
  confidence: z.number().min(0).max(1),
  verified: z.boolean(),
});
export type ResearchStatistic = z.infer<typeof ResearchStatisticSchema>;

export const ExpertQuoteSchema = z.object({
  quote: z.string().min(1),
  attribution: z.string().min(1),
  source: z.string().url(),
});
export type ExpertQuote = z.infer<typeof ExpertQuoteSchema>;

/** The plan's "find the strongest argument against the dominant narrative" step — mandatory, singular, steelmanned. */
export const CounterargumentSchema = z.object({
  dominantNarrative: z.string().min(1),
  strongestCounterEvidence: z.string().min(1),
  source: z.string().url(),
});
export type Counterargument = z.infer<typeof CounterargumentSchema>;

export const CausalAnalysisSchema = z.object({
  whatHappened: z.string().min(1),
  whyItHappened: z.string().min(1),
  whoIsAffected: z.string().min(1),
});
export type CausalAnalysis = z.infer<typeof CausalAnalysisSchema>;

export const HistoricalPrecedentSchema = z.object({
  similarEvent: z.string().min(1),
  outcome: z.string().min(1),
  whatsDifferentNow: z.string().min(1),
});
export type HistoricalPrecedent = z.infer<typeof HistoricalPrecedentSchema>;

/** Built by comparing our own findings against the competitor/hackernews-sourced results specifically. */
export const ContentGapSchema = z.object({
  whatCompetitorsCovered: z.string().min(1),
  whatsMissing: z.string().min(1),
  recommendedAngle: z.string().min(1),
});
export type ContentGap = z.infer<typeof ContentGapSchema>;

/**
 * The plan's "Research Pack" (agent #3) — a deep-dive on one already-approved
 * topic. Every claim is tagged with the source URL and evidence tier it came
 * from; nothing here is ever emitted without a citation (CLAUDE.md: never
 * fabricate facts).
 */
export const ResearchPackSchema = z.object({
  runId: z.string().min(1),
  topic: z.string().min(1),
  generatedAt: z.string(),
  facts: z.array(ResearchFactSchema),
  statistics: z.array(ResearchStatisticSchema),
  expertQuotes: z.array(ExpertQuoteSchema),
  counterargument: CounterargumentSchema,
  causalAnalysis: CausalAnalysisSchema,
  historicalPrecedent: z.array(HistoricalPrecedentSchema),
  contentGap: ContentGapSchema,
  recommendedStructure: z.array(z.string().min(1)).min(1),
  sources: z.array(SourceSchema).min(1),
});
export type ResearchPack = z.infer<typeof ResearchPackSchema>;
