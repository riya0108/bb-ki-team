'use client';

import { useState } from 'react';
import { RotateCcw, ThumbsUp } from 'lucide-react';
import type { BlogDraft } from '@ai-company/shared-types';

function errorMessageFrom(body: unknown, response: Response): string {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : `Request failed (${String(response.status)})`;
}

/**
 * Self-contained "draft" gate approval UI — the full read-before-you-approve
 * surface (title/excerpt/content/sources + Approve/Request changes), reused
 * by the live-run view and the drafts list so a draft can be read and acted
 * on from either place.
 */
export function DraftApprovalPanel({
  runId,
  draft,
  onDecided,
  approveUrl,
}: {
  runId: string;
  draft: BlogDraft;
  onDecided?: () => void;
  /** Defaults to the 'blog' workflow's proxy route — pass to reuse this panel for another workflow (e.g. content-intelligence). */
  approveUrl?: string;
}) {
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: 'approved' | 'changes_requested', extra: { feedback?: string } = {}) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(approveUrl ?? `/api/blog/run/${runId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...extra }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessageFrom(body, response));
      onDecided?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-neutral-200 bg-white/60 p-5 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div>
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Draft v{draft.draftVersion} · {draft.wordCount} words
        </p>
        <h2 className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">{draft.title}</h2>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{draft.excerpt}</p>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-300">
        <pre className="whitespace-pre-wrap font-sans">{draft.content}</pre>
      </div>
      <div className="flex flex-wrap gap-2">
        {draft.sources.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="max-w-[260px] truncate text-xs text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-500 dark:text-violet-400 dark:decoration-violet-800"
          >
            {url}
          </a>
        ))}
      </div>
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => {
            void submit('approved');
          }}
          className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ThumbsUp className="h-4 w-4" />
          Approve &amp; publish to bullorbear.in
        </button>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Requested changes — e.g. make the intro more controversial"
            className="w-full flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-violet-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-white dark:placeholder:text-neutral-600"
          />
          <button
            type="button"
            disabled={isSubmitting || feedback.trim().length === 0}
            onClick={() => {
              const trimmed = feedback.trim();
              setFeedback('');
              void submit('changes_requested', { feedback: trimmed });
            }}
            className="flex items-center justify-center gap-2 rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            <RotateCcw className="h-4 w-4" />
            Request changes
          </button>
        </div>
      </div>
    </div>
  );
}
