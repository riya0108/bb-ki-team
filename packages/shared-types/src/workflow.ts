import { z } from 'zod';
import { TrendSignalSchema } from './trend.js';
import { ResearchPackSchema } from './researchPack.js';
import { BlogDraftSchema } from './blogDraft.js';

export const WorkflowRunStatusSchema = z.enum([
  'queued',
  'running',
  'awaiting_approval',
  'succeeded',
  'failed',
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const TaskStatusSchema = z.enum(['pending', 'claimed', 'running', 'succeeded', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskAgentSchema = z.enum([
  'research',
  'trend-research',
  'research-pack',
  'writer',
  'blog-publisher',
  'blog-topic-finder',
  'youtube-viral-finder',
  'instagram-viral-finder',
  'content-strategy',
]);
export type TaskAgent = z.infer<typeof TaskAgentSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string().min(1),
  workflowName: z.string().min(1),
  status: WorkflowRunStatusSchema,
  input: z.unknown(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  workflowRunId: z.string().min(1),
  agent: TaskAgentSchema,
  taskType: z.string().min(1),
  status: TaskStatusSchema,
  payload: z.unknown(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  availableAt: z.string(),
  claimedBy: z.string().nullable(),
  claimedAt: z.string().nullable(),
  dependsOnTaskId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

/**
 * Typed payload contracts between workflow steps, per CLAUDE.md ("explicit,
 * typed data contracts... over passing loosely-shaped objects"). Producers
 * (apps/api, apps/worker's chaining resolvers) and consumers (apps/worker's
 * dispatch) both validate against these rather than trusting `unknown`.
 */
export const RunResearchTaskPayloadSchema = z.object({ query: z.string().min(1) });
export type RunResearchTaskPayload = z.infer<typeof RunResearchTaskPayloadSchema>;

/** trend-research's "gather_signals" task payload — the research-with-trends workflow's first step. */
export const GatherSignalsTaskPayloadSchema = z.object({ topic: z.string().min(1) });
export type GatherSignalsTaskPayload = z.infer<typeof GatherSignalsTaskPayloadSchema>;

/**
 * research's "run_research" payload once chained after trend-research —
 * superset of RunResearchTaskPayloadSchema (trendSignals optional) so the
 * same dispatch handler serves both the standalone and chained workflows.
 */
export const RunResearchWithTrendsTaskPayloadSchema = RunResearchTaskPayloadSchema.extend({
  trendSignals: z.array(TrendSignalSchema).optional(),
});
export type RunResearchWithTrendsTaskPayload = z.infer<
  typeof RunResearchWithTrendsTaskPayloadSchema
>;

/** research-pack's "build_pack" task payload — the approved topic, as it exists once picked at the "topic" gate. */
export const BuildResearchPackTaskPayloadSchema = z.object({
  topic: z.string().min(1),
  angle: z.string().min(1),
  topicFinderSources: z.array(z.string().url()),
  modificationNote: z.string().min(1).optional(),
});
export type BuildResearchPackTaskPayload = z.infer<typeof BuildResearchPackTaskPayloadSchema>;

/**
 * writer's "write_draft" task payload — serves both the initial draft (no `revision`) and a
 * revision pass (`revision` present) with the same handler, per CLAUDE.md's typed-contract rule.
 */
export const WriteDraftTaskPayloadSchema = z.object({
  topic: z.string().min(1),
  researchPack: ResearchPackSchema,
  modificationNote: z.string().min(1).optional(),
  revision: z
    .object({
      previousDraft: BlogDraftSchema,
      feedback: z.string().min(1),
    })
    .optional(),
});
export type WriteDraftTaskPayload = z.infer<typeof WriteDraftTaskPayloadSchema>;

/** wordpress-publisher's "publish_post" task payload — only ever created after the "draft" gate records `approved`. */
export const PublishPostTaskPayloadSchema = z.object({
  draft: BlogDraftSchema,
});
export type PublishPostTaskPayload = z.infer<typeof PublishPostTaskPayloadSchema>;
