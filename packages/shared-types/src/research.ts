import { z } from 'zod';
import { SourceTypeSchema } from './sourceType.js';
import { MomentumStateSchema, TrendSignalSchema } from './trend.js';
import {
  CrossPlatformScoreSchema,
  OverlapStatusSchema,
  ScoreBreakdownSchema,
  TitleConceptsSchema,
  TrendLifecycleSchema,
} from './scoring.js';

export const SourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  snippet: z.string(),
  searchQuery: z.string().min(1),
  sourceType: SourceTypeSchema,
  publishedAt: z.string().optional(),
  /** Present for YouTube results — used to flag whether a video came from a tracked competitor channel. */
  channelId: z.string().optional(),
  /** True when this source's channel/feed is on our tracked-competitor list. */
  isTrackedCompetitor: z.boolean().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

export const ScoredTopicSchema = z.object({
  topic: z.string().min(1),
  score: z.number().int().min(0).max(100),
  reason: z.string().min(1),
  sources: z.array(z.string().url()).min(1),
  /** A specific, actionable next step — informed by supportingSignals when present. */
  recommendation: z.string().min(1),
  /** Set only when trend signals matched this topic (see foldTrendSignals.ts). */
  momentum: MomentumStateSchema.optional(),
  supportingSignals: z.array(TrendSignalSchema).default([]),
  /**
   * Populated when this topic came from content-strategy's richer synthesis
   * (see packages/shared-types/src/contentIntelligence.ts) rather than the
   * plain `research` agent — all optional so old runs still validate.
   */
  angle: z.string().min(1).optional(),
  titleConcepts: TitleConceptsSchema.optional(),
  scoreBreakdown: ScoreBreakdownSchema.optional(),
  whyNow: z.string().min(1).optional(),
  trendLifecycle: TrendLifecycleSchema.optional(),
  overlapStatus: OverlapStatusSchema.optional(),
  contentGapNote: z.string().min(1).optional(),
  internalLinkCandidates: z.array(z.string().min(1)).optional(),
  crossPlatformScore: CrossPlatformScoreSchema.optional(),
});
export type ScoredTopic = z.infer<typeof ScoredTopicSchema>;

export const ResearchAgentOutputSchema = z.object({
  query: z.string().min(1),
  runId: z.string().min(1),
  generatedAt: z.string(),
  topics: z.array(ScoredTopicSchema),
});
export type ResearchAgentOutput = z.infer<typeof ResearchAgentOutputSchema>;
