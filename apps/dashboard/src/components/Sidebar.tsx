'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { departments, type Department } from '@/lib/departments';
import type { TeamStat } from '@/lib/teamStatus';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export function Sidebar({ teams, onNavigate }: { teams: TeamStat[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const activeCount = teams.filter((team) => team.state === 'active').length;

  return (
    <div className="flex h-full w-72 shrink-0 flex-col gap-5 border-r border-neutral-200 bg-white/90 px-4 py-6 backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-950/70">
      <div className="flex items-center justify-between px-2">
        <div>
          <p className="text-sm font-semibold tracking-wide text-neutral-900 dark:text-white">AI Company OS</p>
          <p className="text-xs text-neutral-500">Department dashboard</p>
        </div>
      </div>

      <Link
        href="/"
        onClick={onNavigate}
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
          pathname === '/'
            ? 'bg-neutral-200/80 text-neutral-900 dark:bg-neutral-800/80 dark:text-white'
            : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white'
        }`}
      >
        <LayoutGrid className="h-4 w-4 shrink-0" />
        <span>Overview</span>
      </Link>

      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-600">
          Team status · {activeCount} active
        </p>
        <div className="flex-1 space-y-2 overflow-y-auto scrollbar-thin pr-1">
          {teams.map((team) => {
            const department = departments.find((d) => d.id === team.departmentId);
            if (!department) return null;
            return (
              <TeamStatusCard
                key={team.departmentId}
                team={team}
                department={department}
                active={pathname === `/departments/${team.departmentId}`}
                onNavigate={onNavigate}
              />
            );
          })}
        </div>
      </div>

      <ThemeToggle className="w-full" />
    </div>
  );
}

function TeamStatusCard({
  team,
  department,
  active,
  onNavigate,
}: {
  team: TeamStat;
  department: Department;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = department.icon;

  return (
    <Link
      href={`/departments/${department.id}`}
      onClick={onNavigate}
      className={`block rounded-lg border px-3 py-2.5 transition ${
        active
          ? 'border-neutral-300 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/80'
          : 'border-transparent hover:border-neutral-200 hover:bg-neutral-50 dark:hover:border-neutral-800 dark:hover:bg-neutral-900/50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `${department.color}1a`, color: department.color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200">
          {department.name}
        </span>
        <StatusBadge status={team.state} />
      </div>
      <p className="mt-1.5 truncate text-xs text-neutral-500 dark:text-neutral-500">{team.activity}</p>
      <div className="mt-2 flex items-center gap-2">
        <ProgressBar value={team.progress} color={department.color} />
        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-neutral-500">
          {Math.round(team.progress)}%
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-neutral-400 dark:text-neutral-600">{team.detail}</p>
    </Link>
  );
}
