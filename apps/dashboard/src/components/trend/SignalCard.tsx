import type { TrendSignal } from '@ai-company/shared-types';
import { MomentumBadge } from '@/components/ui/MomentumBadge';

const TYPE_LABELS: Record<TrendSignal['type'], string> = {
  hook: 'Hook pattern',
  competitor_post: 'Competitor post',
  trending_topic: 'Trending topic',
  format: 'Format',
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SignalCard({ signal }: { signal: TrendSignal }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-fuchsia-600 dark:text-fuchsia-400">
            {TYPE_LABELS[signal.type]} · {signal.platform}
          </p>
          <h4 className="mt-0.5 text-sm font-medium text-neutral-900 dark:text-white">
            {signal.title}
          </h4>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <MomentumBadge momentum={signal.momentum} />
          <span className="text-xs font-semibold text-neutral-500">{signal.velocityScore}</span>
        </div>
      </div>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{signal.description}</p>
      <a
        href={signal.evidenceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block max-w-full truncate text-xs text-violet-600 underline decoration-violet-300 underline-offset-2 hover:text-violet-500 dark:text-violet-400 dark:decoration-violet-800 dark:hover:text-violet-300"
      >
        {hostnameOf(signal.evidenceUrl)}
      </a>
    </div>
  );
}
