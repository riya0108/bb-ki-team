'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '@/components/theme/ThemeProvider';

const ORDER: Theme[] = ['light', 'dark', 'system'];

const ICONS: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const LABELS: Record<Theme, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'System theme',
};

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${LABELS[theme]} — click to change`}
      aria-label={`Theme: ${LABELS[theme]}. Click to switch.`}
      className={`flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:text-white ${className}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{LABELS[theme]}</span>
    </button>
  );
}
