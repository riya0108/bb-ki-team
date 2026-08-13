import type { ZodType } from 'zod';
import { listRecentWorkflowRuns, listTasksForRun } from '@ai-company/db';
import { getApprovalGate } from '@ai-company/workflows';
import {
  BlogCandidatesOutputSchema,
  BlogDraftSchema,
  PublishedBlogPostSchema,
  ResearchAgentOutputSchema,
  ResearchPackSchema,
  RunResearchTaskPayloadSchema,
  SynthesizeContentStrategyTaskPayloadSchema,
  type ApprovalGate,
  type BlogDraft,
  type PublishedBlogPost,
  type ResearchPack,
  type ScoredTopic,
  type Task,
  type WorkflowRun,
  type WorkflowRunStatus,
} from '@ai-company/shared-types';

export type PipelineWorkflowName = 'blog' | 'content-intelligence';

/**
 * The 4 stages the user's pipeline is organized around: Topic Finder ->
 * Research Agent -> Content Agent -> Blog Agent. Keyed by task type rather
 * than gate, since 'research'/'content-intelligence' have several
 * non-gated topic-finding tasks that all belong to the same visible stage.
 */
export type PipelineStage = 'topic' | 'research' | 'content' | 'blog' | 'done';

const STAGE_BY_TASK_TYPE: Record<string, PipelineStage> = {
  run_research: 'topic',
  generate_candidates: 'topic',
  find_youtube_signals: 'topic',
  find_instagram_signals: 'topic',
  synthesize: 'topic',
  build_pack: 'research',
  write_draft: 'content',
  publish_post: 'blog',
};

export interface PipelineRun {
  id: string;
  workflowName: PipelineWorkflowName;
  status: WorkflowRunStatus;
  /** The topic query (blog) or focus category (content-intelligence), for display. */
  label: string;
  createdAt: string;
  updatedAt: string;
  stage: PipelineStage;
  /**
   * Set only when status is 'awaiting_approval' — derived the same way
   * apps/api's approve endpoint does (from the last succeeded task's type),
   * not by guessing at the shape of `run.output`. That guess used to go
   * silently blank whenever a run's pending output didn't happen to match
   * one of the two known gate shapes.
   */
  gate?: ApprovalGate;
  topics?: ScoredTopic[];
  researchPack?: ResearchPack;
  draft?: BlogDraft;
  publishedPost?: PublishedBlogPost;
  error?: string | null;
}

function labelForRun(run: WorkflowRun, tasks: Task[]): string {
  if (run.workflowName === 'blog') {
    const input = RunResearchTaskPayloadSchema.safeParse(run.input);
    return input.success ? input.data.query : '(unknown topic)';
  }
  // content-intelligence now starts directly at content-strategy's synthesize
  // step (see packages/workflows/src/definitions.ts) — its run input is
  // whatever blogCandidates/youtubeSignals/instagramSignals the user already
  // gathered from the 3 standalone searches, not a focusCategory.
  const input = SynthesizeContentStrategyTaskPayloadSchema.safeParse(run.input);
  if (input.success) return input.data.blogCandidates[0]?.topic ?? '(untitled)';
  // Runs created before that redesign started the whole thing with
  // { focusCategory } and ran blog-topic-finder as their own first task, so
  // run.input never matches the schema above — but the topic is still
  // sitting in that task's own result, so recover it from there instead of
  // showing every pre-redesign run as permanently "(unknown topic)".
  const candidates = latestResult(tasks, 'generate_candidates', BlogCandidatesOutputSchema);
  return candidates?.candidates[0]?.topic ?? '(unknown topic)';
}

/** Most recent succeeded task of a given type whose result validates against `schema`. */
function latestResult<T>(tasks: Task[], taskType: string, schema: ZodType<T>): T | undefined {
  const matches = tasks
    .filter((t) => t.taskType === taskType && t.status === 'succeeded' && t.result != null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const task of matches) {
    const parsed = schema.safeParse(task.result);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

async function toPipelineRun(run: WorkflowRun): Promise<PipelineRun> {
  const workflowName = run.workflowName as PipelineWorkflowName;
  const tasks = await listTasksForRun(run.id);
  const byCreatedAt = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lastTask = byCreatedAt[byCreatedAt.length - 1];
  const lastSucceeded = [...byCreatedAt].reverse().find((t) => t.status === 'succeeded');

  const topics =
    latestResult(byCreatedAt, 'run_research', ResearchAgentOutputSchema)?.topics ??
    latestResult(byCreatedAt, 'synthesize', ResearchAgentOutputSchema)?.topics;
  const researchPack = latestResult(byCreatedAt, 'build_pack', ResearchPackSchema);
  const draft = latestResult(byCreatedAt, 'write_draft', BlogDraftSchema);
  const publishedPost = latestResult(byCreatedAt, 'publish_post', PublishedBlogPostSchema);

  const base = {
    id: run.id,
    workflowName,
    status: run.status,
    label: labelForRun(run, byCreatedAt),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    topics,
    researchPack,
    draft,
    publishedPost,
  };

  if (run.status === 'succeeded') {
    return { ...base, stage: 'done' };
  }
  if (run.status === 'failed') {
    return { ...base, stage: lastTask ? (STAGE_BY_TASK_TYPE[lastTask.taskType] ?? 'topic') : 'topic', error: run.error };
  }
  if (run.status === 'awaiting_approval' && lastSucceeded) {
    return {
      ...base,
      stage: STAGE_BY_TASK_TYPE[lastSucceeded.taskType] ?? 'topic',
      gate: getApprovalGate(workflowName, lastSucceeded.taskType),
    };
  }
  // queued/running — attribute to whichever task is currently in flight (or about to be, if none claimed yet).
  return { ...base, stage: lastTask ? (STAGE_BY_TASK_TYPE[lastTask.taskType] ?? 'topic') : 'topic' };
}

/** Reads blog + content-intelligence workflow runs straight from Postgres, one row per run, stage/gate derived from real task history. */
export async function listPipelineRuns(workflowNames: PipelineWorkflowName[]): Promise<PipelineRun[]> {
  const runs = await listRecentWorkflowRuns();
  const filtered = runs.filter((run) => workflowNames.includes(run.workflowName as PipelineWorkflowName));
  const withStages = await Promise.all(filtered.map(toPipelineRun));
  return withStages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
