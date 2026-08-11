'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import type { PipelineRun } from '@/lib/pipelineRuns';
import { formatDateTime } from '@/lib/formatDate';

function isRelevant(run: PipelineRun): boolean {
  return run.researchPack != null || run.stage === 'research';
}

const POLL_INTERVAL_MS = 3000;

/**
 * Stage 2 of the pipeline: once a topic is approved, the Research Agent
 * (research-pack) deep-dives it — facts, statistics, expert quotes, a
 * steelmanned counterargument, historical precedent, the content gap versus
 * competitors, and a recommended structure — then hands everything to the
 * Content Agent automatically. No approval gate here (CLAUDE.md: only
 * irreversible steps pause for a human), so this view is read-only — it
 * exists purely so this stage is visible instead of folded into a generic
 * spinner on another department's page.
 */
export function ResearchAgentDepartmentView({ initialRuns }: { initialRuns: PipelineRun[] }) {
  const [runs, setRuns] = useState(() => initialRuns.filter(isRelevant));
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  const hasInFlight = runs.some((run) => run.stage === 'research' && run.researchPack == null);
  useEffect(() => {
    if (!hasInFlight) return;
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasInFlight]);

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500 dark:border-neutral-800">
        No topics have reached the Research Agent yet — approve one on the Topic Finder or Content Intelligence
        department to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-white">Research packs</h2>
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
        const pack = run.researchPack;
        return (
          <div
            key={run.id}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/30"
          >
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : run.id)}
              disabled={!pack}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-neutral-100 disabled:cursor-default dark:hover:bg-neutral-900/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">{run.label}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{formatDateTime(run.createdAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!pack ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Gathering research
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500">
                    Sent to Content Agent
                  </span>
                )}
                {pack && (
                  <ChevronDown
                    className={`h-4 w-4 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                )}
              </div>
            </button>

            {isOpen && pack && (
              <div className="space-y-4 border-t border-neutral-200 p-4 text-sm dark:border-neutral-800">
                <Section title="Why this matters">
                  <p className="text-neutral-700 dark:text-neutral-300">{pack.causalAnalysis.whatHappened}</p>
                  <p className="mt-1 text-neutral-700 dark:text-neutral-300">{pack.causalAnalysis.whyItHappened}</p>
                  <p className="mt-1 text-neutral-500 dark:text-neutral-400">Who&apos;s affected: {pack.causalAnalysis.whoIsAffected}</p>
                </Section>

                {pack.facts.length > 0 && (
                  <Section title="Facts">
                    <ul className="space-y-1.5">
                      {pack.facts.map((fact, i) => (
                        <li key={i} className="text-neutral-700 dark:text-neutral-300">
                          {fact.claim}
                          {fact.value ? ` (${fact.value})` : ''}{' '}
                          <span className="text-xs text-neutral-400">[{fact.sourceType}]</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {pack.statistics.length > 0 && (
                  <Section title="Statistics">
                    <ul className="space-y-1.5">
                      {pack.statistics.map((stat, i) => (
                        <li key={i} className="text-neutral-700 dark:text-neutral-300">
                          {stat.stat}
                          {stat.value ? ` (${stat.value})` : ''}{' '}
                          <span className="text-xs text-neutral-400">[{stat.sourceType}]</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {pack.expertQuotes.length > 0 && (
                  <Section title="Expert quotes">
                    <ul className="space-y-1.5">
                      {pack.expertQuotes.map((quote, i) => (
                        <li key={i} className="text-neutral-700 dark:text-neutral-300">
                          &ldquo;{quote.quote}&rdquo; — {quote.attribution}
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                <Section title="Steelmanned counterargument">
                  <p className="text-neutral-500 dark:text-neutral-400">
                    Dominant narrative: {pack.counterargument.dominantNarrative}
                  </p>
                  <p className="mt-1 text-neutral-700 dark:text-neutral-300">
                    {pack.counterargument.strongestCounterEvidence}
                  </p>
                </Section>

                <Section title="Content gap vs. competitors">
                  <p className="text-neutral-500 dark:text-neutral-400">Covered: {pack.contentGap.whatCompetitorsCovered}</p>
                  <p className="mt-1 text-neutral-500 dark:text-neutral-400">Missing: {pack.contentGap.whatsMissing}</p>
                  <p className="mt-1 text-neutral-700 dark:text-neutral-300">Our angle: {pack.contentGap.recommendedAngle}</p>
                </Section>

                <Section title="Recommended structure">
                  <ol className="list-decimal space-y-1 pl-5 text-neutral-700 dark:text-neutral-300">
                    {pack.recommendedStructure.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </Section>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-600">{title}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
