import { z } from 'zod';
import type { EvidenceSourceType, Source } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';

const ExtractedFactSchema = z.object({
  claim: z.string().min(1),
  value: z.string().optional(),
  sourceIndex: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
});

const ExtractedStatisticSchema = z.object({
  stat: z.string().min(1),
  value: z.string().optional(),
  sourceIndex: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
});

const ExtractedQuoteSchema = z.object({
  quote: z.string().min(1),
  attribution: z.string().min(1),
  sourceIndex: z.number().int().min(0),
});

const ExtractedCounterargumentSchema = z.object({
  dominantNarrative: z.string().min(1),
  strongestCounterEvidence: z.string().min(1),
  sourceIndex: z.number().int().min(0),
});

const ExtractedPackSchema = z.object({
  facts: z.array(ExtractedFactSchema),
  statistics: z.array(ExtractedStatisticSchema),
  expertQuotes: z.array(ExtractedQuoteSchema),
  /** The plan's "find the strongest argument against the dominant narrative" step — mandatory. */
  counterargument: ExtractedCounterargumentSchema,
  causalAnalysis: z.object({
    whatHappened: z.string().min(1),
    whyItHappened: z.string().min(1),
    whoIsAffected: z.string().min(1),
  }),
  historicalPrecedent: z
    .array(
      z.object({
        similarEvent: z.string().min(1),
        outcome: z.string().min(1),
        whatsDifferentNow: z.string().min(1),
      }),
    )
    .max(3),
  /** Built specifically by comparing our findings against the sources tagged "TRACKED COMPETITOR" in the listing. */
  contentGap: z.object({
    whatCompetitorsCovered: z.string().min(1),
    whatsMissing: z.string().min(1),
    recommendedAngle: z.string().min(1),
  }),
  recommendedStructure: z.array(z.string().min(1)).min(3).max(8),
});

export type ExtractedPack = z.infer<typeof ExtractedPackSchema>;

/**
 * Deterministic, not model-judged: which evidence tier a source counts as is
 * derived from its actual sourceType, never guessed by the LLM. Wikipedia is
 * `background` by construction — it cannot become a citable fact/statistic
 * source no matter what the model claims.
 */
export function evidenceTypeForSource(source: Source): EvidenceSourceType {
  switch (source.sourceType) {
    case 'wikipedia':
      return 'background';
    case 'youtube':
      return source.isTrackedCompetitor ? 'secondary' : 'community';
    case 'hackernews':
    case 'instagram':
      return 'community';
    case 'competitor':
    case 'news':
    case 'trends':
      return 'secondary';
  }
}

const MAX_SNIPPET_CHARS = 220;

function formatSourceListing(sources: Source[]): string {
  return sources
    .map((s, i) => {
      const tag = s.isTrackedCompetitor ? ' [TRACKED COMPETITOR]' : '';
      const snippet =
        s.snippet.length > MAX_SNIPPET_CHARS ? `${s.snippet.slice(0, MAX_SNIPPET_CHARS)}…` : s.snippet;
      return `[${i}] (${s.sourceType}${tag}) ${s.title}\nURL: ${s.url}\nSnippet: ${snippet}`;
    })
    .join('\n\n');
}

/**
 * The Research Agent's core extraction step. Every claim is tagged with the
 * *index* of the source it came from (never a free-text URL the model could
 * invent) — the caller resolves that index back to the real Source and
 * derives its evidence tier deterministically (see evidenceTypeForSource).
 */
export async function extractResearchPack(
  providers: LlmProviderConfig[],
  topic: string,
  angle: string,
  sources: Source[],
): Promise<ExtractedPack> {
  const sourceList = formatSourceListing(sources);

  return generateStructured({
    providers,
    toolName: 'research_pack',
    schema: ExtractedPackSchema,
    system:
      'You are a research analyst — part journalist, part fact-checker, part competitive-intelligence ' +
      'analyst — building a research pack for a writer about to draft a blog post on an already-approved ' +
      'topic. Extract only what is directly supported by the numbered sources below — every fact, ' +
      'statistic, and quote must be tagged with the sourceIndex of the ONE source it came from. Never ' +
      'invent a sourceIndex outside the given list, never fabricate a statistic or quote not present in ' +
      'a snippet. Sources tagged (wikipedia) are background only — encyclopedic orientation, never a ' +
      'citation-worthy fact or statistic on their own; still fine to draw on for causalAnalysis/' +
      'historicalPrecedent context. Sources tagged (youtube) snippets are the video\'s title/description ' +
      'only, never its spoken content. Sources marked [TRACKED COMPETITOR] are from creators/publications ' +
      'this company tracks — use them specifically for contentGap: compare what they already covered ' +
      'against what our other sources found, and recommend a genuinely different angle, not a rehash. ' +
      'Also produce: causalAnalysis (what happened, why, who is affected — the "why" a good article ' +
      'must answer), historicalPrecedent (has this happened before, what happened, what is different ' +
      'this time — up to 3, only if genuinely applicable), and counterargument — a mandatory steelman: ' +
      'find the strongest evidence against the dominant narrative on this topic, even if every source ' +
      'leans one way; if no direct counter-evidence exists in the sources, say so honestly and cite the ' +
      'most relevant source instead of fabricating one. Finally propose recommendedStructure: 3-8 ' +
      'section headings (H2-level), ordered to build toward a hook-driven, attention-holding piece — not ' +
      'a dry encyclopedic recap.',
    prompt: `Approved topic: "${topic}"\nAngle: "${angle}"\n\nSources:\n${sourceList}`,
    maxTokens: 4096,
  });
}
