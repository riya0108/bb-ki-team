'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2, Sparkles, Square } from 'lucide-react';
import {
  ResearchAgentOutputSchema,
  type BlogCandidate,
  type ScoredTopic,
  type TrendSignal,
} from '@ai-company/shared-types';
import { TopicApprovalPanel } from '@/components/blog/TopicApprovalPanel';

type Phase = 'idle' | 'running' | 'topic_gate' | 'handed_off' | 'failed' | 'cancelled';

interface RunStatusBody {
  run: {
    status: 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';
    output: unknown;
    error: string | null;
  };
}

function errorMessageFrom(body: unknown, response: Response): string {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : `Request failed (${String(response.status)})`;
}

/**
 * Search engine 4 of 4: content-strategy's cross-platform synthesis — the
 * only one of the 4 searches that produces topics for human approval and
 * hands off into the rest of the blog pipeline. Unlike the old design, it
 * does NOT run the other 3 searches itself: it takes whatever
 * blogCandidates/youtubeSignals/instagramSignals the user already gathered
 * from those (lifted state from ContentIntelligenceDepartmentView) as its
 * input. blogCandidates is required — the agent has nothing to rank
 * without at least the blog topic search's results.
 */
export function ContentStrategySearchPanel({
  blogCandidates,
  youtubeSignals,
  instagramSignals,
}: {
  blogCandidates: BlogCandidate[] | null;
  youtubeSignals: TrendSignal[] | null;
  instagramSignals: TrendSignal[] | null;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [topics, setTopics] = useState<ScoredTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const pollTokenRef = useRef(0);

  const poll = useCallback((id: string) => {
    const token = ++pollTokenRef.current;

    const tick = async () => {
      if (pollTokenRef.current !== token) return;
      try {
        const response = await fetch(`/api/content-intelligence/run/${id}`, { cache: 'no-store' });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !body || typeof body !== 'object' || !('run' in body)) {
          throw new Error(errorMessageFrom(body, response));
        }
        const { run } = body as RunStatusBody;

        if (run.status === 'queued' || run.status === 'running') {
          setPhase('running');
          setTimeout(() => void tick(), 1500);
          return;
        }
        if (run.status === 'failed') {
          setError(run.error ?? 'Workflow run failed');
          setPhase('failed');
          return;
        }
        if (run.status === 'cancelled') {
          setPhase('cancelled');
          return;
        }
        if (run.status === 'succeeded') {
          setPhase('handed_off');
          return;
        }

        const topicPack = ResearchAgentOutputSchema.safeParse(run.output);
        if (topicPack.success) {
          setTopics(topicPack.data.topics);
          setPhase('topic_gate');
          return;
        }
        setPhase('handed_off');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setPhase('failed');
      }
    };

    void tick();
  }, []);

  async function handleStart() {
    if (phase === 'running' || !blogCandidates || blogCandidates.length === 0) return;

    setError(null);
    setTopics(null);
    setIsStopping(false);
    setPhase('running');

    try {
      const response = await fetch('/api/content-intelligence/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogCandidates,
          youtubeSignals: youtubeSignals ?? [],
          instagramSignals: instagramSignals ?? [],
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== 'object' || !('runId' in body)) {
        throw new Error(errorMessageFrom(body, response));
      }
      const { runId: newRunId } = body as { runId: string };
      setRunId(newRunId);
      poll(newRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('failed');
    }
  }

  function handleDecided() {
    if (!runId) return;
    setTopics(null);
    setPhase('running');
    poll(runId);
  }

  async function handleStop() {
    if (!runId || isStopping) return;
    setIsStopping(true);
    pollTokenRef.current++; // invalidates the in-flight poll loop's recursive tick
    try {
      const response = await fetch(`/api/content-intelligence/run/${runId}`, { method: 'POST' });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(errorMessageFrom(body, response));
      }
      setPhase('cancelled');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('failed');
    } finally {
      setIsStopping(false);
    }
  }

  const canRun = !!blogCandidates && blogCandidates.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/40 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-neutral-600 dark:text-neutral-400">
          {canRun ? (
            <>
              Using <span className="font-medium text-neutral-900 dark:text-white">{blogCandidates?.length}</span>{' '}
              blog candidate{blogCandidates?.length === 1 ? '' : 's'}
              {youtubeSignals ? `, ${youtubeSignals.length} YouTube signal${youtubeSignals.length === 1 ? '' : 's'}` : ''}
              {instagramSignals
                ? `, ${instagramSignals.length} Instagram signal${instagramSignals.length === 1 ? '' : 's'}`
                : ''}
              .
            </>
          ) : (
            'Run the blog topic search first — this search ranks its candidates. YouTube/Instagram signals are optional extras.'
          )}
        </div>
        <button
          type="button"
          disabled={phase === 'running' || !canRun}
          onClick={() => {
            void handleStart();
          }}
          className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === 'running' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Working…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Synthesize content strategy
            </>
          )}
        </button>
        {phase === 'running' && (
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

      {phase === 'cancelled' && (
        <div className="rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          Stopped — no further LLM/search calls were made for that run.
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {phase === 'running' && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Cross-referencing signals and ranking the top 3…</span>
        </div>
      )}

      {phase === 'topic_gate' && topics && runId && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-white">Approve a topic</h2>
          <TopicApprovalPanel
            runId={runId}
            topics={topics}
            onDecided={handleDecided}
            approveUrl={`/api/content-intelligence/run/${runId}/approve`}
          />
        </div>
      )}

      {phase === 'handed_off' && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-sm text-emerald-300">
          <p className="font-medium">Topic approved — sent to the Research Agent.</p>
          <p className="mt-1 text-xs text-emerald-400/80">
            Check the Research Agent, Content, and Blog Agent departments to follow it the rest of the way.
          </p>
        </div>
      )}

      {phase === 'idle' && !error && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-800">
          Run this search to synthesize a ranked top 3 and send one for approval.
        </div>
      )}
    </div>
  );
}
