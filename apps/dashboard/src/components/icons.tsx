import type { ReactNode } from 'react';

import type { Platform } from '../api/client';

// Small brand-colored glyphs for the platform picker (spec 17.1's one-tab-per-agent
// selector) — minimal inline SVGs so the dashboard has no external icon dependency.
const ICONS: Record<Platform, { bg: string; node: ReactNode }> = {
  linkedin: {
    bg: '#0a66c2',
    node: (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="#fff" aria-hidden="true">
        <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.64h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.4c0-1.29-.02-2.95-1.8-2.95-1.8 0-2.08 1.4-2.08 2.86V21h-4V9Z" />
      </svg>
    ),
  },
  x: {
    bg: '#000',
    node: (
      <svg viewBox="0 0 24 24" width="12" height="12" fill="#fff" aria-hidden="true">
        <path d="M18.24 2.75h3.06l-6.69 7.64 7.87 10.86h-6.16l-4.83-6.32-5.52 6.32H2.9l7.16-8.18L2.5 2.75h6.32l4.37 5.78 5.05-5.78Zm-1.07 16.66h1.7L7.02 4.5H5.2l11.97 14.91Z" />
      </svg>
    ),
  },
  instagram: {
    bg: 'linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)',
    node: (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.2" cy="6.8" r="1" fill="#fff" stroke="none" />
      </svg>
    ),
  },
  'youtube-shorts': {
    bg: '#ff0000',
    node: (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="#fff" aria-hidden="true">
        <path d="M9.5 8.5v7l6-3.5-6-3.5Z" />
      </svg>
    ),
  },
  blog: {
    bg: '#3a3a42',
    node: (
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" strokeWidth="1.8" aria-hidden="true">
        <path d="M7 3h7l4 4v14H7V3Z" />
        <path d="M14 3v4h4" />
        <path d="M9.5 12.5h5M9.5 15.5h5" strokeLinecap="round" />
      </svg>
    ),
  },
};

export function PlatformIcon({ platform }: { platform: Platform }) {
  const icon = ICONS[platform];
  return (
    <span className="platform-icon" style={{ background: icon.bg }}>
      {icon.node}
    </span>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

export function NewChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 5h16v10H9.5L5 18.5V15H4V5Z" strokeLinejoin="round" />
      <path d="M9 8.5h6M9 11.5h4" strokeLinecap="round" />
    </svg>
  );
}
