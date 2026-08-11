import { z } from 'zod';
import type { BlogCandidate, TrendSignal } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';

const scored100 = z.number().int().min(0).max(100);

const CrossReferenceSchema = z.object({
  index: z.number().int().min(0),
  instagramTrend: scored100,
  youtubeTrend: scored100,
  deepDivePotential: scored100,
  note: z.string().min(1),
  matchedYoutubeSignalIndexes: z.array(z.number().int().min(0)).default([]),
  matchedInstagramSignalIndexes: z.array(z.number().int().min(0)).default([]),
});
const CrossReferenceListSchema = z.object({ crossReferences: z.array(CrossReferenceSchema) });
export type CrossReference = z.infer<typeof CrossReferenceSchema>;

function formatCandidates(candidates: BlogCandidate[]): string {
  return candidates.map((c, i) => `[${i}] "${c.topic}" (${c.category})\nAngle: ${c.angle}`).join('\n\n');
}

function formatSignals(label: string, signals: TrendSignal[]): string {
  if (signals.length === 0) return `${label}: (none)`;
  return `${label}:\n${signals
    .map((s, i) => `[${i}] "${s.title}" (${s.momentum}, outlier ${String(s.outlierScore ?? 0)}) — ${s.description}`)
    .join('\n')}`;
}

/**
 * The plan's cross-platform relevance step (§39/§40): for each blog
 * candidate, judges how much genuine momentum it has on YouTube/Instagram —
 * grounded to specific signal indexes so nothing is invented — and, crucially,
 * whether that momentum is actually relevant to a deep-dive blog article
 * (deepDivePotential) rather than a pure meme/entertainment trend that
 * happens to share a keyword. Instagram/YouTube trend scores alone never
 * drive the final adjustment in index.ts — deepDivePotential gates them.
 */
export async function crossReferenceSignals(
  providers: LlmProviderConfig[],
  blogCandidates: BlogCandidate[],
  youtubeSignals: TrendSignal[],
  instagramSignals: TrendSignal[],
): Promise<CrossReference[]> {
  if (youtubeSignals.length === 0 && instagramSignals.length === 0) {
    return blogCandidates.map((_, index) => ({
      index,
      instagramTrend: 0,
      youtubeTrend: 0,
      deepDivePotential: 0,
      note: 'No social signals available for this run.',
      matchedYoutubeSignalIndexes: [],
      matchedInstagramSignalIndexes: [],
    }));
  }

  const { crossReferences } = await generateStructured({
    providers,
    toolName: 'cross_reference_signals',
    schema: CrossReferenceListSchema,
    system:
      'You cross-reference candidate blog topics against YouTube and Instagram trend signals. For each ' +
      'blog candidate, judge: instagramTrend/youtubeTrend (0-100, how much of the platform\'s signal ' +
      'genuinely relates to this candidate\'s topic/angle — 0 if nothing relates), and deepDivePotential ' +
      '(0-100: even if the platform trend is huge, is the underlying story substantial enough to support ' +
      'a 900+ word deep-dive article, or is it just a meme/pure-entertainment trend? A viral meme with a ' +
      'keyword overlap should score LOW deepDivePotential even with high instagramTrend/youtubeTrend). ' +
      'Cite matchedYoutubeSignalIndexes/matchedInstagramSignalIndexes for the specific signals that ' +
      'justify your scores — never invent a match. Return one entry per candidate.',
    prompt:
      `Blog candidates:\n${formatCandidates(blogCandidates)}\n\n` +
      `${formatSignals('YouTube signals', youtubeSignals)}\n\n` +
      `${formatSignals('Instagram signals', instagramSignals)}`,
    maxTokens: 4096,
  });

  return crossReferences;
}
