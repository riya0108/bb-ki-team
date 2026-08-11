import {
  BlogDraftSchema,
  BuildResearchPackTaskPayloadSchema,
  PublishPostTaskPayloadSchema,
  ResearchAgentOutputSchema,
  RunResearchTaskPayloadSchema,
  SynthesizeContentStrategyTaskPayloadSchema,
  TopicSelectionSchema,
  WriteDraftTaskPayloadSchema,
  type ApprovalDecision,
} from '@ai-company/shared-types';
import type { NextStep } from './steps.js';

export interface ApprovalContext {
  decision: ApprovalDecision;
  selection?: unknown;
  feedback?: string;
  /** The result of the task that triggered this gate (its `tasks.result`). */
  gatedResult: unknown;
  /** The payload of the task that triggered this gate (its `tasks.payload`). */
  gatedPayload: unknown;
  /** The workflow this run belongs to — 'blog' and 'content-intelligence' redo differently on rejection. */
  workflowName: string;
  /** The original `POST /workflows/:name/run` input for this run — needed to redo a rejected topic batch from scratch. */
  runInput: unknown;
}

export type ApprovalResolver = (ctx: ApprovalContext) => NextStep;

/**
 * Shared by 'blog' and 'content-intelligence' — both converge on
 * research-pack after their 'topic' gate (content-strategy's output is a
 * plain ResearchAgentOutput, same shape as `research`'s). Extracted rather
 * than duplicated per CLAUDE.md's "no duplicate responsibilities".
 *
 * Supports rejection: "changes_requested" + feedback re-runs the workflow's
 * topic-producing step from scratch with the same original input. For
 * 'blog' (the plain `research` agent) that's a plain redo — that agent has
 * no rejection-feedback input. For 'content-intelligence' it re-runs
 * content-strategy's synthesize step over the same blogCandidates/
 * youtubeSignals/instagramSignals this run was started with (those searches
 * themselves are separate, standalone workflows now — see
 * packages/workflows/src/definitions.ts — so rejecting a synthesized batch
 * re-ranks from the same inputs rather than re-running every search). The
 * "Do Not Recommend" feedback loop (apps/worker/src/dispatch.ts's
 * blog-topic-finder case reading recent "changes_requested" feedback) still
 * applies the next time the blog-topic-finder search itself is run.
 */
const resolveTopicApproval: ApprovalResolver = (ctx) => {
  if (ctx.decision === 'changes_requested') {
    if (!ctx.feedback) {
      throw new Error('"topic" gate: decision "changes_requested" requires feedback');
    }
    if (ctx.workflowName === 'blog') {
      return {
        agent: 'research',
        taskType: 'run_research',
        payload: RunResearchTaskPayloadSchema.parse(ctx.runInput),
      };
    }
    if (ctx.workflowName === 'content-intelligence') {
      return {
        agent: 'content-strategy',
        taskType: 'synthesize',
        payload: SynthesizeContentStrategyTaskPayloadSchema.parse(ctx.runInput),
      };
    }
    throw new Error(`"topic" gate: no rejection/redo path registered for workflow "${ctx.workflowName}"`);
  }

  const { topics } = ResearchAgentOutputSchema.parse(ctx.gatedResult);
  const { selectedTopicIndex, modificationNote } = TopicSelectionSchema.parse(ctx.selection);
  const topic = topics[selectedTopicIndex];
  if (!topic) {
    throw new Error(`selectedTopicIndex ${String(selectedTopicIndex)} is out of range`);
  }
  return {
    agent: 'research-pack',
    taskType: 'build_pack',
    payload: BuildResearchPackTaskPayloadSchema.parse({
      topic: topic.topic,
      angle: topic.recommendation,
      topicFinderSources: topic.sources,
      ...(modificationNote ? { modificationNote } : {}),
    }),
  };
};

/** Shared by 'blog' and 'content-intelligence' — both converge on writer/blog-publisher after 'draft'. */
const resolveDraftApproval: ApprovalResolver = (ctx) => {
  const draft = BlogDraftSchema.parse(ctx.gatedResult);
  if (ctx.decision === 'approved') {
    return {
      agent: 'blog-publisher',
      taskType: 'publish_post',
      payload: PublishPostTaskPayloadSchema.parse({ draft }),
    };
  }
  if (!ctx.feedback) {
    throw new Error('"draft" gate: decision "changes_requested" requires feedback');
  }
  const { topic, researchPack, modificationNote } = WriteDraftTaskPayloadSchema.parse(ctx.gatedPayload);
  return {
    agent: 'writer',
    taskType: 'write_draft',
    payload: WriteDraftTaskPayloadSchema.parse({
      topic,
      researchPack,
      ...(modificationNote ? { modificationNote } : {}),
      revision: { previousDraft: draft, feedback: ctx.feedback },
    }),
  };
};

/**
 * Given a human decision at a gate, returns the single next task to enqueue.
 * Thrown errors are the caller's (apps/api's) cue to return 400 — a
 * malformed or workflow-inappropriate decision, not a server fault.
 */
export const WORKFLOW_APPROVAL_RESOLVERS: Record<string, Record<string, ApprovalResolver>> = {
  blog: {
    topic: resolveTopicApproval,
    draft: resolveDraftApproval,
  },
  'content-intelligence': {
    topic: resolveTopicApproval,
    draft: resolveDraftApproval,
  },
};

export function getApprovalResolver(
  workflowName: string,
  gate: string,
): ApprovalResolver | undefined {
  return WORKFLOW_APPROVAL_RESOLVERS[workflowName]?.[gate];
}
