import { z } from 'zod';
import { MomentumStateSchema } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import type { ScoredVideoCandidate } from './computeOutlierScores.js';

const ClassifiedSchema = z.object({
  index: z.number().int().min(0),
  description: z.string().min(1),
  momentum: MomentumStateSchema,
});
const ClassifiedListSchema = z.object({ classified: z.array(ClassifiedSchema) });
export type Classified = z.infer<typeof ClassifiedSchema>;

function formatListing(candidates: ScoredVideoCandidate[]): string {
  return candidates
    .map(
      (c, i) =>
        `[${i}] "${c.title}"\nMatched topic: ${c.matchedTopic}\nOutlier score: ${String(c.outlierScore)}` +
        `${c.subscriberCount !== undefined ? ` (channel: ${String(c.subscriberCount)} subs)` : ''}` +
        `${c.viewCount !== undefined ? `, ${String(c.viewCount)} views` : ''}` +
        `${c.publishedAt ? `, published ${c.publishedAt}` : ''}\nDescription: ${c.description}`,
    )
    .join('\n\n');
}

/**
 * LLM classifies why each high-outlier video is spreading (format/hook) and
 * its momentum (emerging/peaking/declining, judged from recency + framing —
 * a single snapshot has no historical view-count series to measure true
 * velocity from, so this is a best-effort read, not a measurement).
 */
export async function classifySignals(
  providers: LlmProviderConfig[],
  candidates: ScoredVideoCandidate[],
): Promise<Classified[]> {
  if (candidates.length === 0) return [];

  const { classified } = await generateStructured({
    providers,
    toolName: 'youtube_signal_classification',
    schema: ClassifiedListSchema,
    system:
      'You analyze YouTube videos that are outliers relative to their channel size (an outlier score ' +
      'near 100 means the video is getting far more views than that channel normally gets). For each, ' +
      'write one description sentence naming the format (e.g. explainer, reaction, short-form, ' +
      'interview), the likely hook, and why it is spreading. Also classify momentum: "rising" if the ' +
      'publish date and framing suggest this is new/still gaining, "peaking" if it looks like the top ' +
      'of its cycle, "declining" if it reads as an older story past its peak.',
    prompt: `Candidates:\n${formatListing(candidates)}`,
    maxTokens: 4096,
  });

  return classified;
}
