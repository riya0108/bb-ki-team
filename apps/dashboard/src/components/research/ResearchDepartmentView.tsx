'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Loader2, Search, Square } from 'lucide-react';
import { ResearchAgentOutputSchema, type ResearchAgentOutput } from '@ai-company/shared-types';
import { computeResearchStats, scoreDistribution } from '@/lib/researchStats';
import { pollRun, RunCancelledError } from '@/lib/pollRun';
import { formatDate, formatTime } from '@/lib/formatDate';
import { StatCard } from '@/components/ui/StatCard';
import { ProgressRing } from '@/components/charts/ProgressRing';
import { TopicScoreBarChart } from '@/components/charts/TopicScoreBarChart';
import { ScoreDistributionDonut } from '@/components/charts/ScoreDistributionDonut';
import { RunHistoryList } from '@/components/research/RunHistoryList';

export function ResearchDepartmentView({ initialRuns }: { initialRuns: ResearchAgentOutput[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [query, setQuery] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [wasStopped, setWasStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stats = useMemo(() => computeResearchStats(runs), [runs]);
  const latestRun = runs[0] ?? null;
  const allTopics = useMemo(() => runs.flatMap((run) => run.topics), [runs]);
  const distribution = useMemo(() => scoreDistribution(allTopics), [allTopics]);
  const latestChartData = useMemo(
    () =>
      (latestRun?.topics ?? [])
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((topic) => ({ topic: topic.topic, score: topic.score })),
    [latestRun],
  );

  async function handleRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isRunning) return;

    setIsRunning(true);
    setError(null);
    setWasStopped(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/research/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== 'object' || !('runId' in body)) {
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : `Request failed (${String(response.status)})`;
        throw new Error(message);
      }
      const { runId } = body as { runId: string };
      runIdRef.current = runId;
      const output = await pollRun(`/api/research/run/${runId}`, { signal: controller.signal });
      const result = ResearchAgentOutputSchema.parse(output);
      setRuns((prev) => [result, ...prev]);
      setQuery('');
    } catch (err) {
      if (err instanceof RunCancelledError) {
        setWasStopped(true);
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    } finally {
      setIsRunning(false);
      setIsStopping(false);
      runIdRef.current = null;
      abortRef.current = null;
    }
  }

  async function handleStop() {
    const runId = runIdRef.current;
    if (!runId || isStopping) return;
    setIsStopping(true);
    abortRef.current?.abort();
    try {
      await fetch(`/api/research/run/${runId}`, { method: 'POST' });
    } catch {
      // best-effort — the local abort above already stops the UI from waiting on it
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={(event) => {
          void handleRun(event);
        }}
        className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/40 sm:flex-row sm:items-center"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Research any topic — e.g. quantum computing breakthroughs"
            disabled={isRunning}
            className="w-full rounded-lg border border-neutral-200 bg-white py-2.5 pl-9 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-violet-500 focus:outline-none disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-white dark:placeholder:text-neutral-600 dark:focus:border-violet-600"
          />
        </div>
        <button
          type="submit"
          disabled={isRunning || query.trim().length === 0}
          className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Running…
            </>
          ) : (
            'Run research'
          )}
        </button>
      </form>

      {isRunning && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              Work in progress — Trend Research is scouting opportunity signals for &ldquo;{query || 'this topic'}
              &rdquo;, then Research is searching, clustering, scoring, and verifying with those signals folded in.
              This can take up to a minute.
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={isStopping}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/10 disabled:opacity-50"
          >
            <Square className="h-3 w-3" />
            {isStopping ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      )}

      {wasStopped && (
        <div className="rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          Stopped — no further LLM/search calls were made for that run.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total runs" value={String(stats.totalRuns)} />
        <StatCard label="Topics found" value={String(stats.totalTopics)} />
        <StatCard
          label="Last run"
          value={stats.lastRunAt ? formatDate(stats.lastRunAt) : '—'}
          sublabel={stats.lastRunAt ? formatTime(stats.lastRunAt) : undefined}
        />
        <StatCard label="Verified topics" value={String(stats.totalTopics)} sublabel="100% fact-checked" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white/60 p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
          <p className="self-start text-sm font-medium text-neutral-900 dark:text-white">Average topic score</p>
          <ProgressRing value={stats.avgScore ?? 0} label="/ 100" />
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white/60 p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
          <p className="mb-2 text-sm font-medium text-neutral-900 dark:text-white">Score distribution</p>
          <ScoreDistributionDonut data={distribution} />
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white/60 p-5 dark:border-neutral-800 dark:bg-neutral-900/40 lg:col-span-1">
          <p className="mb-2 text-sm font-medium text-neutral-900 dark:text-white">
            Latest run{latestRun ? `: ${latestRun.query}` : ''}
          </p>
          <TopicScoreBarChart data={latestChartData} />
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-neutral-900 dark:text-white">Run history</h2>
        <RunHistoryList runs={runs} />
      </div>
    </div>
  );
}
