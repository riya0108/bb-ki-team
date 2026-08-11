import { z } from 'zod';
import { MomentumStateSchema } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import type { PostCandidate } from './searchPosts.js';

const scored100 = z.number().int().min(0).max(100);

const ClassifiedSchema = z.object({
  index: z.number().int().min(0),
  description: z.string().min(1),
  momentum: MomentumStateSchema,
  /**
   * Brave's index has no engagement metrics (likes/views/followers) — unlike
   * youtube-viral-finder's real subscriber-normalized outlier score, this is
   * an LLM judgment call from title/snippet text alone (recency, framing,
   * how many distinct posts/accounts are covering it). Documented as an
   * approximation, not a measurement.
   */
  velocityScore: scored100,
});
const ClassifiedListSchema = z.object({ classified: z.array(ClassifiedSchema).max(12) });
export type Classified = z.infer<typeof ClassifiedSchema>;

const MAX_CANDIDATES_IN_PROMPT = 30;

function formatListing(candidates: PostCandidate[]): string {
  return candidates
    .slice(0, MAX_CANDIDATES_IN_PROMPT)
    .map(
      (c, i) =>
        `[${i}] "${c.title}"\nMatched topic: ${c.matchedTopic}${c.publishedAt ? `\nPosted: ${c.publishedAt}` : ''}\nSnippet: ${c.description}`,
    )
    .join('\n\n');
}

/**
 * LLM selects and scores the most interesting Instagram candidates from the
 * search results — no real engagement metrics exist here (see
 * BraveInstagramClient), so relevance/momentum/velocity are judgment calls
 * from text alone, not measurements. Remember a social trend is not
 * automatically a good blog topic (plan §40/§43) — content-strategy applies
 * the actual cross-platform gating later.
 */
export async function classifySignals(
  providers: LlmProviderConfig[],
  candidates: PostCandidate[],
): Promise<Classified[]> {
  if (candidates.length === 0) return [];

  const { classified } = await generateStructured({
    providers,
    toolName: 'instagram_signal_classification',
    schema: ClassifiedListSchema,
    system:
      'You review Instagram search results (titles/snippets only — no like/view/follower counts are ' +
      'available) and select up to 12 that look like genuine, currently-active discussion on the given ' +
      'topics rather than old or unrelated pages. For each selected candidate, write one description ' +
      'sentence naming the likely format (reel/carousel/story/post) and why it seems to be getting ' +
      'attention, classify momentum ("rising"/"peaking"/"declining", judged from the posted date and ' +
      'framing), and estimate velocityScore 0-100 — how much genuine, currently-accelerating discussion ' +
      'this represents, based on framing and recency alone since no engagement numbers are available. ' +
      'Be conservative: without real metrics, do not inflate scores just because a topic sounds exciting.',
    prompt: `Candidates:\n${formatListing(candidates)}`,
    maxTokens: 4096,
  });

  return classified;
}
