'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import type { TeamStat } from '@/lib/teamStatus';
import { Sidebar } from '@/components/Sidebar';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export function AppShell({ teams, children }: { teams: TeamStat[]; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-950/80 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          <Menu className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold text-neutral-900 dark:text-white">AI Company OS</p>
        <ThemeToggle className="!w-auto !px-2.5 [&>span]:hidden" />
      </header>

      <aside className="hidden shrink-0 md:block">
        <div className="sticky top-0 h-screen">
          <Sidebar teams={teams} />
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div className="relative z-10 h-full max-w-[85vw]">
            <Sidebar teams={teams} onNavigate={() => setMobileOpen(false)} />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
