// The dashboard's own copy of the shared secret apps/api's auth.ts checks (only
// enforced there once DASHBOARD_SHARED_SECRET is set — see that file). Local dev
// against a loopback API never needs one; this only matters once the API is
// deployed somewhere reachable from the internet (2026-09-16).
const STORAGE_KEY = 'bb-dashboard-token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}
