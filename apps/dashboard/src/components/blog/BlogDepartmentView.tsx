'use client';

import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { ResearchAgentOutputSchema, type ScoredTopic } from '@ai-company/shared-types';
import { TopicApprovalPanel } from '@/components/blog/TopicApprovalPanel';

type Phase = 'idle' | 'running' | 'topic_gate' | 'handed_off' | 'failed';

interface RunStatusBody {
  run: {
    status: 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed';
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
 * Stage 1 of the pipeline, driven live from the dashboard: submit a topic ->
 * approve (or reject) one of the Topic Finder's candidates. Once approved,
 * the run moves on to the Research Agent automatically — this view doesn't
 * follow it there; check the Research Agent / Content / Blog Agent
 * departments to watch the rest of the pipeline. Each `awaiting_approval`
 * stop is a human approval gate (CLAUDE.md: "human approval before
 * irreversible actions"). For runs from earlier sessions, see the runs list
 * below, which reads persisted state straight from Postgres.
 */
export function BlogDepartmentView() {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [topics, setTopics] = useState<ScoredTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTokenRef = useRef(0);

  const poll = useCallback((id: string) => {
    const token = ++pollTokenRef.current;

    const tick = async () => {
      if (pollTokenRef.current !== token) return;
      try {
        const response = await fetch(`/api/blog/run/${id}`, { cache: 'no-store' });
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
        if (run.status === 'succeeded') {
          setPhase('handed_off');
          return;
        }

        // awaiting_approval — a fresh topic batch (from the initial run, or a
        // rejected batch's redo) parses as topics; anything else means the
        // run has already moved past this stage (the 'draft' gate belongs to
        // the Content department now).
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

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || phase === 'running') return;

    setError(null);
    setTopics(null);
    setPhase('running');

    try {
      const response = await fetch('/api/blog/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
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

  return (
    <div className="space-y-8">
      <form
        onSubmit={(event) => {
          void handleStart(event);
        }}
        className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white/60 p-4 dark:border-neutral-800 dark:bg-neutral-900/40 sm:flex-row sm:items-center"
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Blog topic to research — e.g. AI agents replacing traditional SaaS"
          disabled={phase === 'running'}
          className="w-full flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-violet-500 focus:outline-none disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-white dark:placeholder:text-neutral-600 dark:focus:border-violet-600"
        />
        <button
          type="submit"
          disabled={phase === 'running' || query.trim().length === 0}
          className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === 'running' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Working…
            </>
          ) : (
            'Find topics'
          )}
        </button>
      </form>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {phase === 'running' && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Working — searching and scoring topic candidates.</span>
        </div>
      )}

      {phase === 'topic_gate' && topics && runId && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-white">Approve a topic</h2>
          <TopicApprovalPanel runId={runId} topics={topics} onDecided={handleDecided} />
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
    </div>
  );
}
