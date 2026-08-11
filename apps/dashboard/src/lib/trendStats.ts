import type { TrendResearchAgentOutput } from '@ai-company/shared-types';

export interface TrendStats {
  totalRuns: number;
  totalSignals: number;
  avgVelocity: number | null;
  lastRunAt: string | null;
}

export function computeTrendStats(runs: TrendResearchAgentOutput[]): TrendStats {
  const allSignals = runs.flatMap((run) => run.signals);
  const avgVelocity =
    allSignals.length > 0
      ? allSignals.reduce((sum, signal) => sum + signal.velocityScore, 0) / allSignals.length
      : null;

  return {
    totalRuns: runs.length,
    totalSignals: allSignals.length,
    avgVelocity,
    lastRunAt: runs[0]?.generatedAt ?? null,
  };
}
