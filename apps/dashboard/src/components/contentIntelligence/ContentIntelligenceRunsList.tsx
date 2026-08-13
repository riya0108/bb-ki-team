'use client';

import { useState } from 'react';
import { ChevronDown, Loader2, RefreshCw, Square } from 'lucide-react';
import type { PipelineRun } from '@/lib/pipelineRuns';
import { TopicApprovalPanel } from '@/components/blog/TopicApprovalPanel';
import { formatDateTime } from '@/lib/formatDate';

function errorMessageFrom(body: unknown, response: Response): string {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : `Request failed (${String(response.status)})`;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-neutral-500/10 text-neutral-500' },
  running: { label: 'Working', className: 'bg-amber-500/10 text-amber-500' },
  awaiting_approval: { label: 'Awaiting topic approval', className: 'bg-violet-500/10 text-violet-500' },
  handed_off: { label: 'Sent to Research Agent', className: 'bg-emerald-500/10 text-emerald-500' },
  failed: { label: 'Failed', className: 'bg-rose-500/10 text-rose-500' },
  cancelled: { label: 'Stopped', className: 'bg-neutral-500/10 text-neutral-500' },
};

function statusInfo(run: PipelineRun): { label: string; className: string } {
  if (run.status === 'awaiting_approval' && run.gate === 'topic') return STATUS_LABEL.awaiting_approval;
  if (run.status === 'failed') return STATUS_LABEL.failed;
  if (run.status === 'cancelled') return STATUS_LABEL.cancelled;
  if (run.status === 'queued' || run.status === 'running') return STATUS_LABEL[run.status];
  return STATUS_LABEL.handed_off;
}

/**
 * Persisted Content Intelligence runs, independent of whichever browser tab
 * started them. Gate is read from the run's actual task history (see
 * pipelineRuns.ts), not guessed from output shape — a run that's moved past
 * the topic stage (or that got stuck between the fully-autonomous
 * signal-gathering steps) never renders a blank, button-less panel anymore.
 */
export function ContentIntelligenceRunsList({ initialRuns }: { initialRuns: PipelineRun[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [expandedId, setExpandedId] = useState<string | null>(
    initialRuns.find((r) => r.status === 'awaiting_approval' && r.gate === 'topic')?.id ?? null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  async function refresh() {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/content-intelligence/runs', { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && body && typeof body === 'object' && 'runs' in body) {
        setRuns((body as { runs: PipelineRun[] }).runs);
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleDecided() {
    setExpandedId(null);
    setTimeout(() => void refresh(), 1500);
  }

  /** Stops a queued/running run — see apps/api's handleCancel for how it handles a run whose worker has died mid-flight, not just a live one. */
  async function handleStop(runId: string) {
    if (stoppingId) return;
    setStopError(null);
    setStoppingId(runId);
    try {
      const response = await fetch(`/api/content-intelligence/run/${runId}`, { method: 'POST' });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessageFrom(body, response));
      await refresh();
    } catch (err) {
      setStopError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setStoppingId(null);
    }
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-800">
        No Content Intelligence runs yet — start one above to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-white">Runs</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-900"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {runs.map((run) => {
        const isOpen = expandedId === run.id;
        const status = statusInfo(run);
        return (
          <div
            key={run.id}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/30"
          >
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : run.id)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">{run.label}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{formatDateTime(run.createdAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {run.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />}
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${status.className}`}>
                  {status.label}
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
                {run.status === 'awaiting_approval' && run.gate === 'topic' && run.topics && (
                  <TopicApprovalPanel
                    runId={run.id}
                    topics={run.topics}
                    onDecided={handleDecided}
                    approveUrl={`/api/content-intelligence/run/${run.id}/approve`}
                  />
                )}
                {run.status === 'failed' && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
                    {run.error ?? 'Workflow run failed'}
                  </div>
                )}
                {(run.status === 'running' || run.status === 'queued') && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Still working — refresh in a bit.
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleStop(run.id)}
                        disabled={stoppingId === run.id}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/10 disabled:opacity-50"
                      >
                        <Square className="h-3 w-3" />
                        {stoppingId === run.id ? 'Stopping…' : 'Stop'}
                      </button>
                    </div>
                    {stopError && (
                      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300">
                        {stopError}
                      </div>
                    )}
                  </div>
                )}
                {((run.status === 'awaiting_approval' && run.gate !== 'topic') || run.status === 'succeeded') && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-300">
                    Sent to the Research Agent — check the Research Agent, Content, and Blog Agent departments.
                  </div>
                )}
                {run.status === 'cancelled' && (
                  <div className="rounded-lg border border-neutral-300 bg-neutral-100 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
                    Stopped — no further LLM/search calls were made for this run.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
