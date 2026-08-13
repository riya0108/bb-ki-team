'use client';

import { useRef, useState } from 'react';
import { Loader2, Newspaper, Square } from 'lucide-react';
import {
  BlogCandidatesOutputSchema,
  EDITORIAL_UNIVERSE,
  type BlogCandidate,
  type EditorialCategory,
} from '@ai-company/shared-types';
import { pollRun, RunCancelledError } from '@/lib/pollRun';

function BlogCandidateCard({ candidate }: { candidate: BlogCandidate }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-pink-600 dark:text-pink-400">
            {candidate.category}
          </p>
          <h4 className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-white">{candidate.topic}</h4>
        </div>
        <span className="shrink-0 rounded-full bg-pink-500/10 px-2 py-1 text-xs font-semibold text-pink-600 dark:text-pink-400">
          {candidate.totalScore}
        </span>
      </div>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{candidate.reason}</p>
      <p className="mt-2 text-xs text-neutral-500">
        <span className="font-medium text-neutral-600 dark:text-neutral-400">Angle: </span>
        {candidate.angle}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        <span className="font-medium text-neutral-600 dark:text-neutral-400">Why now: </span>
        {candidate.whyNow}
      </p>
    </div>
  );
}

/**
 * Search engine 1 of 4 (see ContentIntelligenceDepartmentView): blog topic
 * candidates only — runs on its own, shows only its own results.
 * `onResult` hands the candidates up so the Content Strategy search (engine
 * 4) can optionally use them as its required input, without this panel
 * auto-triggering anything downstream itself.
 */
export function BlogTopicSearchPanel({
  onResult,
}: {
  onResult: (candidates: BlogCandidate[]) => void;
}) {
  const [focusCategory, setFocusCategory] = useState<EditorialCategory | ''>('');
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [wasStopped, setWasStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BlogCandidate[] | null>(null);
  const runIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function handleRun() {
    if (isRunning) return;
    setIsRunning(true);
    setError(null);
    setWasStopped(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/content-intelligence/blog-topics/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(focusCategory ? { focusCategory } : {}),
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
      const output = await pollRun(`/api/content-intelligence/blog-topics/run/${runId}`, {
        signal: controller.signal,
      });
      const result = BlogCandidatesOutputSchema.parse(output);
      setCandidates(result.candidates);
      onResult(result.candidates);
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
      await fetch(`/api/content-intelligence/blog-topics/run/${runId}`, { method: 'POST' });
    } catch {
      // best-effort — the local abort above already stops the UI from waiting on it
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/40 sm:flex-row sm:items-center">
        <select
          value={focusCategory}
          onChange={(event) => setFocusCategory(event.target.value as EditorialCategory | '')}
          disabled={isRunning}
          className="w-full flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 focus:border-pink-500 focus:outline-none disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-white dark:focus:border-pink-600"
        >
          <option value="">All categories (weighted by editorial universe — just a reference for search bias)</option>
          {EDITORIAL_UNIVERSE.map((p) => (
            <option key={p.category} value={p.category}>
              {p.category} (weight {p.weight})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={isRunning}
          onClick={() => {
            void handleRun();
          }}
          className="flex items-center justify-center gap-2 rounded-lg bg-pink-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </>
          ) : (
            <>
              <Newspaper className="h-4 w-4" />
              Search blog topics
            </>
          )}
        </button>
        {isRunning && (
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={isStopping}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <Square className="h-3 w-3" />
            {isStopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>

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

      {candidates && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {candidates.map((candidate) => (
            <BlogCandidateCard key={candidate.topic} candidate={candidate} />
          ))}
        </div>
      )}

      {!candidates && !isRunning && !error && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-800">
          Run this search to see blog topic candidates here.
        </div>
      )}
    </div>
  );
}
