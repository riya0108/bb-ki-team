'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { TrendResearchAgentOutput } from '@ai-company/shared-types';
import { SignalCard } from '@/components/trend/SignalCard';
import { formatDateTime } from '@/lib/formatDate';

export function TrendRunHistoryList({ runs }: { runs: TrendResearchAgentOutput[] }) {
  const [openRunId, setOpenRunId] = useState<string | null>(runs[0]?.runId ?? null);

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-800">
        No runs yet — scout a topic above to see signals here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const isOpen = openRunId === run.runId;
        return (
          <div
            key={run.runId}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/30"
          >
            <button
              type="button"
              onClick={() => setOpenRunId(isOpen ? null : run.runId)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                  {run.topic}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {formatDateTime(run.generatedAt)} · {run.signals.length} signals
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {isOpen && (
              <div className="grid grid-cols-1 gap-3 p-4 pt-0 md:grid-cols-2">
                {run.signals.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
