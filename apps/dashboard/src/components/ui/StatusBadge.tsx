export type BadgeStatus = 'active' | 'idle' | 'planned' | 'running';

const STYLES: Record<BadgeStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30',
  idle: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-sky-500/30',
  running: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/30 animate-pulse',
  planned: 'bg-neutral-500/10 text-neutral-500 dark:text-neutral-400 ring-neutral-500/30',
};

const LABELS: Record<BadgeStatus, string> = {
  active: 'Active',
  idle: 'Idle',
  running: 'Running',
  planned: 'Coming soon',
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {status === 'active' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
      {LABELS[status]}
    </span>
  );
}
