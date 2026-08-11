import { z } from 'zod';
import { SourceSchema } from './research.js';
import { TrendSignalSchema } from './trend.js';
import { EditorialCategorySchema } from './editorialUniverse.js';
import { ScoreBreakdownSchema, TitleConceptsSchema, TrendLifecycleSchema, OverlapStatusSchema } from './scoring.js';

/** Content-only archive record (plan §"Blog archive data" decision — no performance stats until real analytics exist). */
export const ArchivePostSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  pubDate: z.string().min(1),
  description: z.string().optional(),
});
export type ArchivePost = z.infer<typeof ArchivePostSchema>;

export const ContentDnaSchema = z.object({
  bestCategories: z.array(z.string().min(1)),
  bestArticleTypes: z.array(z.string().min(1)),
  bestLengthRange: z.string().min(1),
  bestTitlePattern: z.string().min(1),
  strongestAudience: z.string().min(1),
  strongestAngles: z.array(z.string().min(1)),
});
export type ContentDna = z.infer<typeof ContentDnaSchema>;

export const BlogCandidateSchema = z.object({
  topic: z.string().min(1),
  category: EditorialCategorySchema,
  angle: z.string().min(1),
  titleConcepts: TitleConceptsSchema,
  scoreBreakdown: ScoreBreakdownSchema,
  totalScore: z.number().int().min(0).max(100),
  reason: z.string().min(1),
  risk: z.string().min(1),
  whyNow: z.string().min(1),
  trendLifecycle: TrendLifecycleSchema,
  overlapStatus: OverlapStatusSchema,
  contentGapNote: z.string().min(1),
  internalLinkCandidates: z.array(z.string().min(1)).default([]),
  sources: z.array(SourceSchema).default([]),
});
export type BlogCandidate = z.infer<typeof BlogCandidateSchema>;

export const BlogCandidatesOutputSchema = z.object({
  runId: z.string().min(1),
  generatedAt: z.string(),
  contentDna: ContentDnaSchema,
  candidates: z.array(BlogCandidateSchema),
});
export type BlogCandidatesOutput = z.infer<typeof BlogCandidatesOutputSchema>;

export const GenerateBlogCandidatesTaskPayloadSchema = z.object({
  focusCategory: EditorialCategorySchema.optional(),
});
export type GenerateBlogCandidatesTaskPayload = z.infer<typeof GenerateBlogCandidatesTaskPayloadSchema>;

/**
 * `blogCandidates` is only ever used for baton-passing forward to
 * content-strategy when this runs as part of the chained 'content-intelligence'
 * workflow — the agent itself only searches on `candidateTopics` (see
 * packages/agents/youtube-viral-finder/src/index.ts). Optional/defaulted so
 * this search also runs standalone (its own 'youtube-viral-finder' workflow,
 * see packages/workflows/src/definitions.ts) with just topics typed in by hand.
 */
export const FindYoutubeSignalsTaskPayloadSchema = z.object({
  candidateTopics: z.array(z.string().min(1)),
  blogCandidates: z.array(BlogCandidateSchema).default([]),
});
export type FindYoutubeSignalsTaskPayload = z.infer<typeof FindYoutubeSignalsTaskPayloadSchema>;

/**
 * instagram-viral-finder's task payload — same shape as youtube-viral-finder's
 * (both now autonomous, search-engine-driven agents). `blogCandidates` and
 * `youtubeSignals` are only used for baton-passing when chained inside
 * 'content-intelligence'; the agent itself only searches on
 * `candidateTopics`, so both are optional/defaulted for this search's own
 * standalone 'instagram-viral-finder' workflow.
 */
export const FindInstagramSignalsTaskPayloadSchema = z.object({
  candidateTopics: z.array(z.string().min(1)),
  blogCandidates: z.array(BlogCandidateSchema).default([]),
  youtubeSignals: z.array(TrendSignalSchema).default([]),
});
export type FindInstagramSignalsTaskPayload = z.infer<typeof FindInstagramSignalsTaskPayloadSchema>;

/**
 * content-strategy's search still genuinely needs blogCandidates (it cross-
 * references and ranks them — see packages/agents/content-strategy) so that
 * stays required; youtubeSignals/instagramSignals are optional/defaulted so
 * this search can run on its own even when the YouTube/Instagram searches
 * weren't run first.
 */
export const SynthesizeContentStrategyTaskPayloadSchema = z.object({
  blogCandidates: z.array(BlogCandidateSchema).min(1),
  youtubeSignals: z.array(TrendSignalSchema).default([]),
  instagramSignals: z.array(TrendSignalSchema).default([]),
});
export type SynthesizeContentStrategyTaskPayload = z.infer<typeof SynthesizeContentStrategyTaskPayloadSchema>;
