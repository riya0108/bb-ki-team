'use client';

import { useState } from 'react';
import { RotateCcw, ThumbsUp } from 'lucide-react';
import type { ScoredTopic } from '@ai-company/shared-types';
import { TopicCard } from '@/components/research/TopicCard';

function errorMessageFrom(body: unknown, response: Response): string {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : `Request failed (${String(response.status)})`;
}

/** Self-contained "topic" gate approval UI — reused by the live-run view and the drafts list. */
export function TopicApprovalPanel({
  runId,
  topics,
  onDecided,
  approveUrl,
}: {
  runId: string;
  topics: ScoredTopic[];
  onDecided?: () => void;
  /** Defaults to the 'blog' workflow's proxy route — pass to reuse this panel for another workflow (e.g. content-intelligence). */
  approveUrl?: string;
}) {
  const [modificationNote, setModificationNote] = useState('');
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: Record<string, unknown>) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(approveUrl ?? `/api/blog/run/${runId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessageFrom(responseBody, response));
      onDecided?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function approve(selectedTopicIndex: number) {
    await submit({
      decision: 'approved',
      selection: {
        selectedTopicIndex,
        ...(modificationNote.trim() ? { modificationNote: modificationNote.trim() } : {}),
      },
    });
  }

  async function reject() {
    const trimmed = rejectFeedback.trim();
    if (!trimmed) return;
    setRejectFeedback('');
    await submit({ decision: 'changes_requested', feedback: trimmed });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {topics.map((topic, index) => (
          <div key={topic.topic} className="space-y-2">
            <TopicCard topic={topic} />
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                void approve(index);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ThumbsUp className="h-4 w-4" />
              Approve this topic
            </button>
          </div>
        ))}
      </div>
      <textarea
        value={modificationNote}
        onChange={(event) => setModificationNote(event.target.value)}
        placeholder="Optional modification note (applies when approving) — e.g. focus more on small businesses"
        rows={2}
        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-violet-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-white dark:placeholder:text-neutral-600"
      />
      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800 sm:flex-row">
        <input
          value={rejectFeedback}
          onChange={(event) => setRejectFeedback(event.target.value)}
          placeholder="None of these — why, so the next batch avoids it (required to reject)"
          className="w-full flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-violet-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-white dark:placeholder:text-neutral-600"
        />
        <button
          type="button"
          disabled={isSubmitting || rejectFeedback.trim().length === 0}
          onClick={() => {
            void reject();
          }}
          className="flex items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          <RotateCcw className="h-4 w-4" />
          Reject all — find new topics
        </button>
      </div>
    </div>
  );
}
