import {
  FindInstagramSignalsTaskPayloadSchema,
  FindYoutubeSignalsTaskPayloadSchema,
  GatherSignalsTaskPayloadSchema,
  GenerateBlogCandidatesTaskPayloadSchema,
  RunResearchTaskPayloadSchema,
  SynthesizeContentStrategyTaskPayloadSchema,
  type TaskAgent,
} from '@ai-company/shared-types';
import type { ZodType } from 'zod';

export interface WorkflowDefinition {
  firstTask: { agent: TaskAgent; taskType: string };
  /** Validates the run's input. */
  inputSchema: ZodType;
  /** Maps validated input to the first task's payload — defaults to passing input through unchanged. */
  toFirstTaskPayload?: (input: unknown) => unknown;
}

/**
 * Registered workflows this API can start. Deliberately just a lookup map,
 * not a generic workflow-definition DSL — this repo has a handful of workflows.
 * Shared between apps/api (starts runs) and apps/worker (chains/gates them) so
 * neither app imports the other.
 */
export const WORKFLOW_DEFINITIONS: Record<string, WorkflowDefinition> = {
  research: {
    firstTask: { agent: 'research', taskType: 'run_research' },
    inputSchema: RunResearchTaskPayloadSchema,
  },
  'research-with-trends': {
    firstTask: { agent: 'trend-research', taskType: 'gather_signals' },
    inputSchema: RunResearchTaskPayloadSchema,
    toFirstTaskPayload: (input) => {
      const { query } = RunResearchTaskPayloadSchema.parse(input);
      return GatherSignalsTaskPayloadSchema.parse({ topic: query });
    },
  },
  'trend-research': {
    firstTask: { agent: 'trend-research', taskType: 'gather_signals' },
    inputSchema: GatherSignalsTaskPayloadSchema,
  },
  /**
   * The plan's v0.1 milestone: Topic Finder (research's existing run_research
   * task) -> topic approval -> Research Agent -> Writer -> draft approval ->
   * WordPress Publisher. The first leg reuses `research` unchanged.
   */
  blog: {
    firstTask: { agent: 'research', taskType: 'run_research' },
    inputSchema: RunResearchTaskPayloadSchema,
  },
  /**
   * Four independent, on-demand search engines — deliberately NOT chained
   * together into one auto-run pipeline. Each is its own workflow with no
   * next step (see packages/workflows/src/steps.ts): a user runs whichever
   * one they want and only that search's own results come back. Compare to
   * the old design where starting 'content-intelligence' ran all of
   * blog-topic-finder -> youtube-viral-finder -> instagram-viral-finder ->
   * content-strategy in one shot and only showed the merged synthesis.
   */
  'blog-topic-finder': {
    firstTask: { agent: 'blog-topic-finder', taskType: 'generate_candidates' },
    inputSchema: GenerateBlogCandidatesTaskPayloadSchema,
  },
  'youtube-viral-finder': {
    firstTask: { agent: 'youtube-viral-finder', taskType: 'find_youtube_signals' },
    inputSchema: FindYoutubeSignalsTaskPayloadSchema,
  },
  'instagram-viral-finder': {
    firstTask: { agent: 'instagram-viral-finder', taskType: 'find_instagram_signals' },
    inputSchema: FindInstagramSignalsTaskPayloadSchema,
  },
  /**
   * The 4th search engine, content-strategy — and the front door into the
   * same downstream chain as `blog`: it cross-references whatever
   * blogCandidates/youtubeSignals/instagramSignals results the user already
   * gathered from the 3 searches above (fed in as this run's input, not
   * re-fetched), converges on the same 'topic' approval gate `blog` uses,
   * then reuses blog's exact research-pack -> writer -> draft-gate ->
   * blog-publisher chain unchanged (see
   * packages/workflows/src/resolvers/contentIntelligence.ts).
   */
  'content-intelligence': {
    firstTask: { agent: 'content-strategy', taskType: 'synthesize' },
    inputSchema: SynthesizeContentStrategyTaskPayloadSchema,
  },
};
