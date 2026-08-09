'use client';

import type { ComponentType } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { departments } from '@/lib/departments';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-neutral-800/80 bg-neutral-950/70 px-4 py-6 backdrop-blur md:flex">
      <div className="px-2">
        <p className="text-sm font-semibold tracking-wide text-white">AI Company OS</p>
        <p className="text-xs text-neutral-500">Department dashboard</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto scrollbar-thin">
        <SidebarLink href="/" label="Overview" icon={LayoutGrid} active={pathname === '/'} />

        <p className="mb-1 mt-5 px-3 text-[11px] font-medium uppercase tracking-wider text-neutral-600">
          Departments
        </p>
        {departments.map((department) => {
          const href = `/departments/${department.id}`;
          return (
            <SidebarLink
              key={department.id}
              href={href}
              label={department.name}
              icon={department.icon}
              active={pathname === href}
              muted={department.status === 'planned'}
              dotColor={department.status === 'active' ? department.color : undefined}
            />
          );
        })}
      </nav>
    </aside>
  );
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  muted,
  dotColor,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  muted?: boolean;
  dotColor?: string;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
        active
          ? 'bg-neutral-800/80 text-white'
          : muted
            ? 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300'
            : 'text-neutral-300 hover:bg-neutral-900 hover:text-white'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {dotColor && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />}
    </Link>
  );
}
