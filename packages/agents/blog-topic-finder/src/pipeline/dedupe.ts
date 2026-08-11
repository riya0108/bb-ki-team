import type { Source } from '@ai-company/shared-types';

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const normalized = `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`.replace(/\/+$/, '');
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function dedupeSources(sources: Source[]): Source[] {
  const seen = new Map<string, Source>();
  for (const source of sources) {
    const key = normalizeUrl(source.url);
    if (!seen.has(key)) {
      seen.set(key, source);
    }
  }
  return [...seen.values()];
}
