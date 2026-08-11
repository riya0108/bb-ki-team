import type { Source } from '@ai-company/shared-types';

/**
 * Caps the source list shown to the LLM, round-robining across source types
 * so one high-volume source (e.g. Wikipedia, which tends to return the most
 * hits) doesn't crowd out the rest — a plain slice(0, max) on the deduped
 * array would do exactly that, since results are grouped source-major (see
 * pipeline/search.ts). Also keeps the generateCandidates/scoreCandidates
 * prompts within smaller LLM providers' token-per-minute limits (a live run
 * with 87 uncapped sources hit Groq's 12K TPM limit — see index.ts).
 */
export function capSourcesRoundRobin(sources: Source[], max: number): Source[] {
  const bySourceType = new Map<string, Source[]>();
  for (const s of sources) {
    const list = bySourceType.get(s.sourceType) ?? [];
    list.push(s);
    bySourceType.set(s.sourceType, list);
  }
  const groups = [...bySourceType.values()];

  const result: Source[] = [];
  for (let i = 0; result.length < max && groups.some((g) => i < g.length); i++) {
    for (const group of groups) {
      if (result.length >= max) break;
      const item = group[i];
      if (item) result.push(item);
    }
  }
  return result;
}
