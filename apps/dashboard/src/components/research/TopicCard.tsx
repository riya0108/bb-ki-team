import { Compass, Lightbulb } from 'lucide-react';
import type { ScoredTopic } from '@ai-company/shared-types';
import { ScorePill } from '@/components/ui/ScorePill';
import { MomentumBadge } from '@/components/ui/MomentumBadge';

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const TREND_LIFECYCLE_LABEL: Record<string, string> = {
  emerging: 'Emerging',
  accelerating: 'Accelerating',
  peak: 'Peak',
  declining: 'Declining',
  evergreen: 'Evergreen',
  recurring: 'Recurring',
  seasonal: 'Seasonal',
};

/** The 12-factor rubric's weights, for labeling the mini score-breakdown bars — see packages/shared-types/src/scoring.ts. */
const SCORE_BREAKDOWN_LABELS: [key: keyof NonNullable<ScoredTopic['scoreBreakdown']>, label: string][] = [
  ['audienceRelevance', 'Audience'],
  ['trendVelocity', 'Velocity'],
  ['searchOpportunity', 'Search'],
  ['viralPotential', 'Viral'],
  ['thoughtProvocation', 'Thought-provoking'],
  ['originality', 'Originality'],
  ['contentGap', 'Content gap'],
  ['whyNowStrength', 'Why now'],
  ['evergreenValue', 'Evergreen'],
  ['competition', 'Competition'],
  ['internalLinkOpportunity', 'Internal links'],
  ['futurePotential', 'Future potential'],
];

export function TopicCard({ topic }: { topic: ScoredTopic }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium text-neutral-900 dark:text-white">{topic.topic}</h4>
        <div className="flex shrink-0 items-center gap-1.5">
          {topic.momentum && <MomentumBadge momentum={topic.momentum} />}
          <ScorePill score={topic.score} />
        </div>
      </div>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{topic.reason}</p>

      <div className="mt-3 flex items-start gap-2 rounded-md bg-violet-500/5 px-3 py-2 text-xs text-violet-700 dark:text-violet-300">
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{topic.recommendation}</span>
      </div>

      {topic.angle && (
        <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          {topic.trendLifecycle && (
            <span className="inline-flex items-center rounded-full bg-neutral-200/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {TREND_LIFECYCLE_LABEL[topic.trendLifecycle] ?? topic.trendLifecycle}
            </span>
          )}
          {topic.whyNow && (
            <div className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400">
              <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Why now: </span>
                {topic.whyNow}
              </span>
            </div>
          )}
          {topic.titleConcepts && (
            <ul className="space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
              <li>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">SEO: </span>
                {topic.titleConcepts.seo}
              </li>
              <li>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Curiosity: </span>
                {topic.titleConcepts.curiosity}
              </li>
              <li>
                <span className="font-medium text-neutral-700 dark:text-neutral-300">Contrarian: </span>
                {topic.titleConcepts.contrarian}
              </li>
            </ul>
          )}
          {topic.scoreBreakdown && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
              {SCORE_BREAKDOWN_LABELS.map(([key, label]) => {
                const scoreBreakdown = topic.scoreBreakdown;
                if (!scoreBreakdown) return null;
                return (
                  <div key={key} className="flex items-center gap-1.5 text-[10px] text-neutral-500">
                    <span className="w-20 shrink-0 truncate">{label}</span>
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                      <div
                        className="h-full rounded-full bg-violet-500"
                        style={{ width: `${String(scoreBreakdown[key])}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {topic.supportingSignals.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Trend signals ({topic.supportingSignals.length})
          </p>
          {topic.supportingSignals.map((signal) => (
            <a
              key={signal.id}
              href={signal.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-neutral-600 hover:text-violet-600 dark:text-neutral-400 dark:hover:text-violet-400"
            >
              <MomentumBadge momentum={signal.momentum} compact />
              <span className="truncate">{signal.title}</span>
            </a>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {topic.sources.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="max-w-[220px] truncate text-xs text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-500 dark:text-violet-400 dark:decoration-violet-800 dark:hover:text-violet-300"
          >
            {hostnameOf(url)}
          </a>
        ))}
      </div>
    </div>
  );
}
