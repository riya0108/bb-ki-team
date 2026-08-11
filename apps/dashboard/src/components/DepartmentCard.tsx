import type { CSSProperties } from 'react';
import Link from 'next/link';
import type { Department } from '@/lib/departments';
import { StatusBadge } from '@/components/ui/StatusBadge';

export interface DepartmentQuickStats {
  totalRuns: number;
  totalItems: number;
  itemsLabel: string;
  avgScore: number | null;
  scoreLabel: string;
}

export function DepartmentCard({
  department,
  stats,
}: {
  department: Department;
  stats?: DepartmentQuickStats;
}) {
  const Icon = department.icon;

  return (
    <Link
      href={`/departments/${department.id}`}
      style={{ '--accent': department.color } as CSSProperties}
      className="dept-card group relative flex flex-col gap-4 rounded-xl border border-neutral-200 border-l-[3px] bg-white/60 p-5 transition hover:border-neutral-300 hover:bg-white dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${department.color}1a`, color: department.color }}
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="font-medium text-neutral-900 dark:text-white">{department.name}</h2>
            <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500 dark:text-neutral-400">
              {department.description}
            </p>
          </div>
        </div>
        <StatusBadge status={department.status} />
      </div>

      {stats ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <MiniStat label="Runs" value={String(stats.totalRuns)} />
          <MiniStat label={stats.itemsLabel} value={String(stats.totalItems)} />
          <MiniStat label={stats.scoreLabel} value={stats.avgScore !== null ? stats.avgScore.toFixed(0) : '—'} />
        </div>
      ) : (
        <p className="text-xs text-neutral-400 dark:text-neutral-600">No agents configured yet</p>
      )}
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-100 py-2 dark:bg-neutral-950/50">
      <p className="text-sm font-semibold text-neutral-900 dark:text-white">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</p>
    </div>
  );
}
