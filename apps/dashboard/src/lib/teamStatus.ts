import { departments } from '@/lib/departments';
import type { ResearchStats } from '@/lib/researchStats';
import type { TrendStats } from '@/lib/trendStats';
import type { PipelineRun } from '@/lib/pipelineRuns';

export type TeamState = 'active' | 'idle' | 'planned';

export interface TeamStat {
  departmentId: string;
  state: TeamState;
  activity: string;
  detail: string;
  progress: number;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const IN_FLIGHT_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);

/**
 * A department that watches one slice of the shared blog/content-intelligence
 * pipeline (Topic Finder, Research Agent, Content, Blog Agent) — `relevant`
 * picks which runs count toward this department at all, `completed` picks
 * which of those have finished this department's own step (used for the
 * progress bar's completion rate).
 */
function pipelineTeamStat(
  departmentId: string,
  runs: PipelineRun[],
  itemNoun: string,
  relevant: (run: PipelineRun) => boolean,
  completed: (run: PipelineRun) => boolean,
): TeamStat {
  const matching = runs.filter(relevant);
  if (matching.length === 0) {
    return {
      departmentId,
      state: 'idle',
      activity: 'Waiting for first run',
      detail: 'No runs yet',
      progress: 0,
    };
  }

  const done = matching.filter(completed);
  const inFlight = matching.filter((run) => IN_FLIGHT_STATUSES.has(run.status));
  const lastUpdated = matching.reduce((latest, run) => (run.updatedAt > latest ? run.updatedAt : latest), matching[0].updatedAt);

  return {
    departmentId,
    state: inFlight.length > 0 ? 'active' : 'idle',
    activity: `${String(matching.length)} run${matching.length === 1 ? '' : 's'} · ${String(done.length)} ${itemNoun}`,
    detail: `Last activity ${timeAgo(lastUpdated)}`,
    progress: Math.round((done.length / matching.length) * 100),
  };
}

export function getTeamStatuses(
  researchStats: ResearchStats,
  trendStats: TrendStats,
  pipelineRuns: PipelineRun[],
): TeamStat[] {
  return departments.map((department) => {
    if (department.id === 'research') {
      const hasRuns = researchStats.totalRuns > 0;
      return {
        departmentId: department.id,
        state: hasRuns ? 'active' : 'idle',
        activity: hasRuns
          ? `${researchStats.totalRuns} run${researchStats.totalRuns === 1 ? '' : 's'} · ${researchStats.totalTopics} topics found`
          : 'Waiting for first run',
        detail: researchStats.lastRunAt
          ? `Last run ${timeAgo(researchStats.lastRunAt)}`
          : 'No runs yet',
        progress: researchStats.avgScore ?? 0,
      };
    }

    if (department.id === 'trend-research') {
      const hasRuns = trendStats.totalRuns > 0;
      return {
        departmentId: department.id,
        state: hasRuns ? 'active' : 'idle',
        activity: hasRuns
          ? `${trendStats.totalRuns} run${trendStats.totalRuns === 1 ? '' : 's'} · ${trendStats.totalSignals} signals found`
          : 'Waiting for first run',
        detail: trendStats.lastRunAt ? `Last run ${timeAgo(trendStats.lastRunAt)}` : 'No runs yet',
        progress: trendStats.avgVelocity ?? 0,
      };
    }

    // The blog workflow's topic-finding front door.
    if (department.id === 'blog') {
      return pipelineTeamStat(
        department.id,
        pipelineRuns,
        'topics approved',
        (run) => run.workflowName === 'blog',
        (run) => run.stage !== 'topic' || run.status === 'succeeded',
      );
    }

    // Content Intelligence's own topic-finding front door.
    if (department.id === 'content-intelligence') {
      return pipelineTeamStat(
        department.id,
        pipelineRuns,
        'topics approved',
        (run) => run.workflowName === 'content-intelligence',
        (run) => run.stage !== 'topic' || run.status === 'succeeded',
      );
    }

    // Research Agent — shared downstream stage, both front doors feed it.
    if (department.id === 'research-agent') {
      return pipelineTeamStat(
        department.id,
        pipelineRuns,
        'research packs built',
        (run) => run.researchPack != null || run.stage === 'research',
        (run) => run.researchPack != null,
      );
    }

    // Content Agent — shared downstream stage.
    if (department.id === 'content') {
      return pipelineTeamStat(
        department.id,
        pipelineRuns,
        'drafts written',
        (run) => run.draft != null || run.stage === 'content',
        (run) => run.draft != null,
      );
    }

    // Blog Agent — shared final stage.
    if (department.id === 'blog-agent') {
      return pipelineTeamStat(
        department.id,
        pipelineRuns,
        'posts published',
        (run) => run.publishedPost != null || run.stage === 'blog',
        (run) => run.publishedPost != null,
      );
    }

    return {
      departmentId: department.id,
      state: 'planned',
      activity: 'Not yet configured',
      detail: 'Comes online in a later phase',
      progress: 0,
    };
  });
}
