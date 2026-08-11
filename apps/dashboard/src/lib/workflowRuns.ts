import { listRecentWorkflowRuns } from '@ai-company/db';
import {
  ResearchAgentOutputSchema,
  TrendResearchAgentOutputSchema,
  type ResearchAgentOutput,
  type TrendResearchAgentOutput,
} from '@ai-company/shared-types';

const RESEARCH_WORKFLOW_NAMES = new Set(['research', 'research-with-trends']);

/** Reads completed research runs straight from Postgres — no in-process agent calls from the dashboard. */
export async function listResearchRuns(): Promise<ResearchAgentOutput[]> {
  const runs = await listRecentWorkflowRuns();
  return runs
    .filter(
      (run) =>
        RESEARCH_WORKFLOW_NAMES.has(run.workflowName) &&
        run.status === 'succeeded' &&
        run.output != null,
    )
    .map((run) => ResearchAgentOutputSchema.parse(run.output))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export async function listTrendResearchRuns(): Promise<TrendResearchAgentOutput[]> {
  const runs = await listRecentWorkflowRuns();
  return runs
    .filter(
      (run) =>
        run.workflowName === 'trend-research' && run.status === 'succeeded' && run.output != null,
    )
    .map((run) => TrendResearchAgentOutputSchema.parse(run.output))
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}
