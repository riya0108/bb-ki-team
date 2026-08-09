'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ResearchAgentOutput } from '@ai-company/shared-types';
import { TopicCard } from '@/components/research/TopicCard';

export function RunHistoryList({ runs }: { runs: ResearchAgentOutput[] }) {
  const [openRunId, setOpenRunId] = useState<string | null>(runs[0]?.runId ?? null);

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-neutral-500">
        No runs yet — run a query above to see results here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const isOpen = openRunId === run.runId;
        return (
          <div key={run.runId} className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/30">
            <button
              type="button"
              onClick={() => setOpenRunId(isOpen ? null : run.runId)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-neutral-900/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{run.query}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {new Date(run.generatedAt).toLocaleString()} · {run.topics.length} topics
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {isOpen && (
              <div className="grid grid-cols-1 gap-3 p-4 pt-0 md:grid-cols-2">
                {run.topics.map((topic) => (
                  <TopicCard key={topic.topic} topic={topic} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
