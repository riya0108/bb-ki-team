import type { RawCandidate } from './gatherSignals.js';

export interface DedupedCandidate extends RawCandidate {
  /** How many raw hits (across queries/sources) collapsed into this URL — a real, if rough, momentum proxy. */
  mentionCount: number;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const normalized = `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`.replace(
      /\/+$/,
      '',
    );
    return normalized.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Dedupes by normalized URL, keeping the first-seen candidate but counting
 * how many times it was independently surfaced. Mirrors
 * packages/agents/research/src/pipeline/dedupe.ts's normalization, plus the
 * mention count that downstream momentum scoring uses as a real (not
 * fabricated) recency/repetition signal.
 */
export function dedupeCandidates(candidates: RawCandidate[]): DedupedCandidate[] {
  const seen = new Map<string, DedupedCandidate>();
  for (const candidate of candidates) {
    const key = normalizeUrl(candidate.url);
    const existing = seen.get(key);
    if (existing) {
      existing.mentionCount += 1;
    } else {
      seen.set(key, { ...candidate, mentionCount: 1 });
    }
  }
  return [...seen.values()];
}

/**
 * Caps the candidate set before it's sent to an LLM call, ranked by
 * mentionCount (repetition across sources/queries) then recency. Without
 * this, a broad topic can gather 40+ candidates — well past what the
 * scoring/hook-extraction prompts can reliably hold in one structured-output
 * call (research's analogous step only ever scores <=10 clustered topics).
 */
export function rankAndCapCandidates(
  candidates: DedupedCandidate[],
  limit = 20,
): DedupedCandidate[] {
  return [...candidates]
    .sort((a, b) => {
      if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount;
      return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
    })
    .slice(0, limit);
}
