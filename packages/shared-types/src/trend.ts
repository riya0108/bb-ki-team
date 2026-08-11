import { z } from 'zod';
import { SourceTypeSchema } from './sourceType.js';

export const TrendSignalTypeSchema = z.enum([
  'hook',
  'competitor_post',
  'trending_topic',
  'format',
]);
export type TrendSignalType = z.infer<typeof TrendSignalTypeSchema>;

export const MomentumStateSchema = z.enum(['rising', 'peaking', 'declining']);
export type MomentumState = z.infer<typeof MomentumStateSchema>;

export const TrendSignalSchema = z.object({
  id: z.string().min(1),
  type: TrendSignalTypeSchema,
  platform: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  evidenceUrl: z.string().url(),
  momentum: MomentumStateSchema,
  velocityScore: z.number().int().min(0).max(100),
  discoveredAt: z.string(),
  sourceType: SourceTypeSchema,
  /**
   * Set by youtube-viral-finder/instagram-viral-finder: how unusual this
   * signal's reach is relative to its creator's normal audience size (e.g.
   * views ÷ subscriber count) — a 100K-view video from a 20K-subscriber
   * channel is a much stronger signal than the same views from a
   * 20M-subscriber channel. Absent for non-creator-based signal types.
   */
  outlierScore: z.number().int().min(0).max(100).optional(),
  creatorHandle: z.string().optional(),
  audienceSize: z.number().int().min(0).optional(),
});
export type TrendSignal = z.infer<typeof TrendSignalSchema>;

export const TrendResearchAgentOutputSchema = z.object({
  topic: z.string().min(1),
  runId: z.string().min(1),
  generatedAt: z.string(),
  signals: z.array(TrendSignalSchema),
});
export type TrendResearchAgentOutput = z.infer<typeof TrendResearchAgentOutputSchema>;
