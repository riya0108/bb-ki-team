'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import type { PipelineRun } from '@/lib/pipelineRuns';
import { DraftApprovalPanel } from '@/components/blog/DraftApprovalPanel';
import { formatDateTime } from '@/lib/formatDate';

function isRelevant(run: PipelineRun): boolean {
  return run.draft != null || run.stage === 'content';
}

function approveUrlFor(run: PipelineRun): string {
  return run.workflowName === 'blog'
    ? `/api/blog/run/${run.id}/approve`
    : `/api/content-intelligence/run/${run.id}/approve`;
}

const POLL_INTERVAL_MS = 3000;

/**
 * Stage 3 of the pipeline: the Content Agent (writer) turns the Research
 * Agent's pack into a hook-first draft. Approving here sends it on to the
 * Blog Agent for final structuring and publishing; requesting changes sends
 * it back to the Content Agent with your feedback. This is the same
 * `'draft'` approval gate that used to live on the Blog department page —
 * moved here since it's reviewing the Content Agent's work, not the Blog
 * Agent's.
 */
export function ContentDepartmentView({ initialRuns }: { initialRuns: PipelineRun[] }) {
  const [runs, setRuns] = useState(() => initialRuns.filter(isRelevant));
  const [expandedId, setExpandedId] = useState<string | null>(
    initialRuns.find((r) => r.status === 'awaiting_approval' && r.gate === 'draft')?.id ?? null,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function refresh() {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/pipeline/runs', { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && body && typeof body === 'object' && 'runs' in body) {
        setRuns((body as { runs: PipelineRun[] }).runs.filter(isRelevant));
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleDecided() {
    setExpandedId(null);
    setTimeout(() => void refresh(), 1500);
  }

  const hasInFlight = runs.some((run) => run.stage === 'content' && run.draft == null);
  useEffect(() => {
    if (!hasInFlight) return;
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasInFlight]);

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-800">
        No topics have reached the Content Agent yet — approve one on the Topic Finder or Content Intelligence
        department to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-white">Drafts</h2>
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
        const isWriting = run.stage === 'content' && run.draft == null;
        const isDraftGate = run.status === 'awaiting_approval' && run.gate === 'draft';
        return (
          <div
            key={run.id}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/30"
          >
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : run.id)}
              disabled={isWriting}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-neutral-100 disabled:cursor-default dark:hover:bg-neutral-900/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                  {run.draft?.title ?? run.label}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">{formatDateTime(run.createdAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isWriting ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Writing draft
                  </span>
                ) : isDraftGate ? (
                  <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-500">
                    Ready to read &amp; approve
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
                    Sent to Blog Agent
                  </span>
                )}
                {!isWriting && (
                  <ChevronDown
                    className={`h-4 w-4 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                )}
              </div>
            </button>

            {isOpen && run.draft && (
              <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
                {isDraftGate ? (
                  <DraftApprovalPanel
                    runId={run.id}
                    draft={run.draft}
                    onDecided={handleDecided}
                    approveUrl={approveUrlFor(run)}
                  />
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-neutral-500">
                        Draft v{run.draft.draftVersion} · {run.draft.wordCount} words
                      </p>
                      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{run.draft.excerpt}</p>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-950/40">
                      <pre className="whitespace-pre-wrap font-sans text-neutral-700 dark:text-neutral-300">
                        {run.draft.content}
                      </pre>
                    </div>
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
