import type { ResearchAgentOutput, ScoredTopic } from '@ai-company/shared-types';

export interface ResearchStats {
  totalRuns: number;
  totalTopics: number;
  avgScore: number | null;
  lastRunAt: string | null;
}

export function computeResearchStats(runs: ResearchAgentOutput[]): ResearchStats {
  const allTopics = runs.flatMap((run) => run.topics);
  const avgScore =
    allTopics.length > 0 ? allTopics.reduce((sum, topic) => sum + topic.score, 0) / allTopics.length : null;

  return {
    totalRuns: runs.length,
    totalTopics: allTopics.length,
    avgScore,
    lastRunAt: runs[0]?.generatedAt ?? null,
  };
}

export interface ScoreBucket {
  name: 'High' | 'Medium' | 'Low';
  value: number;
}

export function scoreDistribution(topics: ScoredTopic[]): ScoreBucket[] {
  const buckets: Record<ScoreBucket['name'], number> = { High: 0, Medium: 0, Low: 0 };
  for (const topic of topics) {
    if (topic.score >= 80) buckets.High += 1;
    else if (topic.score >= 50) buckets.Medium += 1;
    else buckets.Low += 1;
  }
  return (Object.keys(buckets) as ScoreBucket['name'][]).map((name) => ({ name, value: buckets[name] }));
}
