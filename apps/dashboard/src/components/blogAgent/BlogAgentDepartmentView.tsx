'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { PipelineRun } from '@/lib/pipelineRuns';
import { MarkdownPreview } from '@/components/blog/MarkdownPreview';
import { formatDateTime } from '@/lib/formatDate';

function isRelevant(run: PipelineRun): boolean {
  return run.publishedPost != null || run.stage === 'blog';
}

const POLL_INTERVAL_MS = 3000;

/**
 * Stage 4, the final one: once you approve a draft on the Content
 * department, the Blog Agent (blog-publisher) picks it up here — no
 * approval gate of its own (the 'draft' gate already covered "human
 * approval before irreversible actions"; publishing itself is the
 * irreversible step it guards). What this view adds is the thing that was
 * missing before: a real rendered page preview — headings, bold, links —
 * instead of a wall of raw Markdown, so what you're looking at actually
 * resembles the page bullorbear.in will show once it's live.
 */
export function BlogAgentDepartmentView({ initialRuns }: { initialRuns: PipelineRun[] }) {
  const [runs, setRuns] = useState(() => initialRuns.filter(isRelevant));
  const [expandedId, setExpandedId] = useState<string | null>(
    initialRuns.find(isRelevant)?.id ?? null,
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

  const hasInFlight = runs.some((run) => run.stage === 'blog' && run.publishedPost == null);
  useEffect(() => {
    if (!hasInFlight) return;
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasInFlight]);

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-800">
        No drafts have reached the Blog Agent yet — approve one on the Content department to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-white">Published &amp; publishing</h2>
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
        const isPublishing = run.stage === 'blog' && run.publishedPost == null;
        return (
          <div
            key={run.id}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/30"
          >
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : run.id)}
              disabled={isPublishing || !run.draft}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-neutral-100 disabled:cursor-default dark:hover:bg-neutral-900/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                  {run.draft?.title ?? run.label}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">{formatDateTime(run.createdAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isPublishing ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Structuring &amp; publishing
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
                    {run.publishedPost?.status === 'live' ? 'Live' : 'Committed as draft'}
                  </span>
                )}
                {!isPublishing && run.draft && (
                  <ChevronDown
                    className={`h-4 w-4 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                )}
              </div>
            </button>

            {isOpen && run.draft && (
              <div className="space-y-4 border-t border-neutral-200 p-5 dark:border-neutral-800">
                {run.publishedPost && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
                    <span>
                      {run.publishedPost.status === 'live'
                        ? 'Committed, pushed, and live.'
                        : 'Committed and pushed as a draft — not yet routable until BLOG_PUBLISH_STATUS is set to "live".'}
                    </span>
                    <a
                      href={run.publishedPost.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 underline"
                    >
                      View
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}

                <article className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950/40">
                  <h1 className="text-2xl font-semibold text-neutral-900 dark:text-white">{run.draft.title}</h1>
                  <p className="mt-2 text-neutral-500 dark:text-neutral-400">{run.draft.excerpt}</p>
                  <div className="mt-6">
                    <MarkdownPreview content={run.draft.content} />
                  </div>
                </article>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
