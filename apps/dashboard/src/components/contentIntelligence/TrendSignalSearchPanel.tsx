'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { TrendSignalSchema, type TrendSignal } from '@ai-company/shared-types';
import { pollRun } from '@/lib/pollRun';
import { SignalCard } from '@/components/trend/SignalCard';

const TrendSignalArraySchema = z.array(TrendSignalSchema);

function parseTopics(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Shared by youtube-viral-finder's and instagram-viral-finder's own search
 * panels (engines 2 and 3 of 4 — see ContentIntelligenceDepartmentView).
 * Each runs standalone against its own workflow/API route and shows only
 * its own signals — never auto-triggered by, or combined with, the other
 * searches.
 */
export function TrendSignalSearchPanel({
  apiPath,
  accentClassName,
  buttonClassName,
  icon,
  placeholder,
  runningLabel,
  idleLabel,
  emptyHint,
  prefillTopics,
  onResult,
}: {
  apiPath: string;
  accentClassName: string;
  buttonClassName: string;
  icon: ReactNode;
  placeholder: string;
  runningLabel: string;
  idleLabel: string;
  emptyHint: string;
  /** Optional topics carried over from the blog topic search, so the user doesn't have to retype them. */
  prefillTopics?: string[];
  onResult: (signals: TrendSignal[]) => void;
}) {
  const [topicsInput, setTopicsInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signals, setSignals] = useState<TrendSignal[] | null>(null);

  const topics = parseTopics(topicsInput);

  async function handleRun() {
    if (isRunning || topics.length === 0) return;
    setIsRunning(true);
    setError(null);
    try {
      const response = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateTopics: topics }),
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
      const output = await pollRun(`${apiPath}/${runId}`);
      const result = TrendSignalArraySchema.parse(output);
      setSignals(result);
      onResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <textarea
            value={topicsInput}
            onChange={(event) => setTopicsInput(event.target.value)}
            placeholder={placeholder}
            disabled={isRunning}
            rows={2}
            className={`w-full flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-white dark:placeholder:text-neutral-600 ${accentClassName}`}
          />
          <button
            type="button"
            disabled={isRunning || topics.length === 0}
            onClick={() => {
              void handleRun();
            }}
            className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {runningLabel}
              </>
            ) : (
              <>
                {icon}
                {idleLabel}
              </>
            )}
          </button>
        </div>
        {prefillTopics && prefillTopics.length > 0 && (
          <button
            type="button"
            disabled={isRunning}
            onClick={() => setTopicsInput(prefillTopics.join(', '))}
            className="self-start text-xs text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-700 disabled:opacity-50 dark:decoration-neutral-700 dark:hover:text-neutral-300"
          >
            Use topics from the blog topic search
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {signals && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {signals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 md:col-span-2 dark:border-neutral-800">
              No signals found for those topics.
            </div>
          ) : (
            signals.map((signal) => <SignalCard key={signal.id} signal={signal} />)
          )}
        </div>
      )}

      {!signals && !isRunning && !error && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-800">
          {emptyHint}
        </div>
      )}
    </div>
  );
}
