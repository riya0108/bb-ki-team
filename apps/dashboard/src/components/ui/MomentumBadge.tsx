import { Flame, TrendingDown, TrendingUp } from 'lucide-react';
import type { MomentumState } from '@ai-company/shared-types';

const STYLES: Record<MomentumState, string> = {
  rising: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30',
  peaking: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/30',
  declining: 'bg-neutral-500/10 text-neutral-500 dark:text-neutral-400 ring-neutral-500/30',
};

const ICONS: Record<MomentumState, typeof TrendingUp> = {
  rising: TrendingUp,
  peaking: Flame,
  declining: TrendingDown,
};

export function MomentumBadge({
  momentum,
  compact = false,
}: {
  momentum: MomentumState;
  compact?: boolean;
}) {
  const Icon = ICONS[momentum];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full ring-1 ring-inset ${STYLES[momentum]} ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs font-medium'
      }`}
    >
      <Icon className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {!compact && momentum}
    </span>
  );
}
