import type { TaskAgent } from '@ai-company/shared-types';
import { RESEARCH_WITH_TRENDS_RESOLVERS } from './resolvers/researchWithTrends.js';
import { BLOG_RESOLVERS } from './resolvers/blog.js';
import { CONTENT_INTELLIGENCE_RESOLVERS } from './resolvers/contentIntelligence.js';

export interface NextStep {
  agent: TaskAgent;
  taskType: string;
  payload: unknown;
}

export type NextStepResolver = (result: unknown, originalPayload: unknown) => NextStep | undefined;

const noNextStep: NextStepResolver = () => undefined;

/**
 * Per-workflow, per-completed-task-type resolvers deciding what (if
 * anything) runs next when a task is *not* an approval gate. Deliberately a
 * lookup map, not a generic DAG engine — this repo has a handful of workflows.
 */
const WORKFLOW_STEP_RESOLVERS: Record<string, Record<string, NextStepResolver>> = {
  research: {
    run_research: noNextStep,
  },
  'research-with-trends': RESEARCH_WITH_TRENDS_RESOLVERS,
  'trend-research': {
    gather_signals: noNextStep,
  },
  blog: BLOG_RESOLVERS,
  // The 4 Content Intelligence search engines: standalone, no auto-chaining
  // (see packages/workflows/src/definitions.ts's comment on why).
  'blog-topic-finder': {
    generate_candidates: noNextStep,
  },
  'youtube-viral-finder': {
    find_youtube_signals: noNextStep,
  },
  'instagram-viral-finder': {
    find_instagram_signals: noNextStep,
  },
  'content-intelligence': CONTENT_INTELLIGENCE_RESOLVERS,
};

export function getNextStep(
  workflowName: string,
  completedTaskType: string,
  result: unknown,
  originalPayload: unknown,
): NextStep | undefined {
  const resolver = WORKFLOW_STEP_RESOLVERS[workflowName]?.[completedTaskType];
  return resolver ? resolver(result, originalPayload) : undefined;
}
