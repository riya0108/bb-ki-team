import {
  GatherSignalsTaskPayloadSchema,
  TrendResearchAgentOutputSchema,
} from '@ai-company/shared-types';
import type { NextStepResolver } from '../steps.js';

/**
 * The "research-with-trends" workflow: trend-research's gather_signals runs
 * first, then its signals are handed to research's run_research task.
 * research's own run_research is terminal (no further step) — this table
 * only needs the one non-trivial entry.
 */
export const RESEARCH_WITH_TRENDS_RESOLVERS: Record<string, NextStepResolver> = {
  gather_signals: (result, originalPayload) => {
    const { signals } = TrendResearchAgentOutputSchema.parse(result);
    const { topic } = GatherSignalsTaskPayloadSchema.parse(originalPayload);
    return {
      agent: 'research',
      taskType: 'run_research',
      payload: { query: topic, trendSignals: signals },
    };
  },
  run_research: () => undefined,
};
