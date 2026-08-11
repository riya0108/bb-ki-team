/**
 * Explicit locale (not the runtime's default) on every call — Next.js
 * renders these components on the server first, then hydrates on the
 * client. `toLocaleString()` with no locale argument resolves to each
 * environment's own default locale, which differ (server's Node process vs.
 * the browser's), producing a hydration mismatch. Pinning 'en-IN' makes the
 * output identical everywhere it renders.
 */
const LOCALE = 'en-IN';

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE);
}
