import { z } from 'zod';
import {
  EDITORIAL_UNIVERSE,
  OverlapStatusSchema,
  TitleConceptsSchema,
  TrendLifecycleSchema,
  EditorialCategorySchema,
  type ArchivePost,
  type EditorialCategory,
  type Source,
} from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';

const CandidateDraftSchema = z.object({
  topic: z.string().min(1),
  category: EditorialCategorySchema,
  angle: z.string().min(1),
  titleConcepts: TitleConceptsSchema,
  whyNow: z.string().min(1),
  trendLifecycle: TrendLifecycleSchema,
  overlapStatus: OverlapStatusSchema,
  contentGapNote: z.string().min(1),
  /** Indexes into the search-results listing this candidate is grounded in — never invented. */
  sourceIndexes: z.array(z.number().int().min(0)).min(1),
});
export type CandidateDraft = z.infer<typeof CandidateDraftSchema>;

const CandidatesDraftSchema = z.object({ candidates: z.array(CandidateDraftSchema).min(3).max(20) });

const MAX_SNIPPET_CHARS = 160;
/** Keeps the prompt within smaller LLM providers' token-per-minute limits — see index.ts's MAX_SOURCES_FOR_GENERATION. */
const MAX_ARCHIVE_TITLES_IN_PROMPT = 25;

function formatSourceListing(sources: Source[]): string {
  return sources
    .map((s, i) => {
      const tag = s.isTrackedCompetitor ? ' [TRACKED COMPETITOR — real, recent, actually published]' : '';
      const snippet = s.snippet.length > MAX_SNIPPET_CHARS ? `${s.snippet.slice(0, MAX_SNIPPET_CHARS)}…` : s.snippet;
      return `[${i}] (${s.sourceType}${tag}) ${s.title}\nURL: ${s.url}\nSnippet: ${snippet}`;
    })
    .join('\n\n');
}

function formatUniverse(): string {
  return EDITORIAL_UNIVERSE.map((p) => `${p.category} (weight ${String(p.weight)})`).join(', ');
}

export interface GenerateCandidatesInput {
  sources: Source[];
  archivePosts: ArchivePost[];
  /** Feedback text from past "changes_requested" decisions at the 'topic' gate — the Do Not Recommend signal. */
  rejectionFeedback: string[];
  focusCategory?: EditorialCategory;
}

/**
 * The plan's "generate 20-50 candidates, hidden from the human" stage (§44) —
 * capped at 20 here for real LLM token/cost budget in a single structured
 * call. Each candidate must cite real search-result indexes and is already
 * checked against the archive for overlap, so downstream scoring never has
 * to re-derive grounding.
 */
export async function generateCandidates(
  providers: LlmProviderConfig[],
  input: GenerateCandidatesInput,
): Promise<CandidateDraft[]> {
  const sourceList = formatSourceListing(input.sources);
  const archiveList = input.archivePosts.length
    ? input.archivePosts
        .slice(0, MAX_ARCHIVE_TITLES_IN_PROMPT)
        .map((p) => `[${p.category}] "${p.title}"`)
        .join('\n')
    : '(archive is empty — everything is a new topic)';
  const rejectionList = input.rejectionFeedback.length
    ? input.rejectionFeedback.join('\n')
    : '(no rejection history yet)';

  const draft = await generateStructured({
    providers,
    toolName: 'blog_candidates',
    schema: CandidatesDraftSchema,
    system:
      'You are the Blog Topic Finder for a personal-finance/business/tech/AI publication targeting ' +
      'Indian Gen Z / young professionals. Your job is NOT to find trending topics — it is to find the ' +
      'strongest opportunities for a differentiated, thought-provoking, deep-dive article. A topic can ' +
      'be trending yet be a terrible article; a topic can have huge search volume yet be boring. Prefer ' +
      'specific angles over broad topics (e.g. not "AI agents" but "AI agents are coming for SaaS — but ' +
      'who actually loses?"). Sources tagged [TRACKED COMPETITOR] are real articles/videos our tracked ' +
      'competitor blogs and YouTube channels have actually published this week — treat these as your ' +
      'PRIMARY material: for each one that has real substance, ask what a genuinely better, deeper, or ' +
      'differently-angled piece on the same underlying story would look like (not a rewrite of their ' +
      "piece — a sharper one), or what real gap they left. Don't just react to every [TRACKED COMPETITOR] " +
      'item mechanically — skip ones with nothing worth a differentiated take. Use the other, ' +
      'non-tracked sources as supporting evidence and for topics with no direct competitor coverage yet. ' +
      'Generate up to 20 distinct candidates spread across the editorial universe ' +
      'below, weighted toward higher-weight categories but not exclusively — every candidate must cite ' +
      'the source-listing index/indexes it is grounded in (sourceIndexes), never an invented source. For ' +
      'each candidate, classify overlapStatus against the archive listing: "already_covered" (do not ' +
      'recommend re-running an existing topic verbatim), "partially_covered" (existing coverage misses a ' +
      'real angle), "new_angle" (topic covered before but this angle is genuinely new), or "new_topic". ' +
      'Also avoid recommending anything resembling the rejection history below — that reflects the ' +
      "human editor's stated taste. Classify trendLifecycle honestly (emerging/accelerating/peak/" +
      'declining/evergreen/recurring/seasonal) from what the sources actually show. whyNow must be a ' +
      'concrete, falsifiable reason grounded in the sources — if you cannot state one, downgrade the ' +
      'candidate\'s trendLifecycle toward "evergreen" rather than inventing urgency.',
    prompt:
      `Editorial universe: ${formatUniverse()}${input.focusCategory ? `\nFocus category: ${input.focusCategory}` : ''}\n\n` +
      `Search results:\n${sourceList}\n\n` +
      `Archive (already published):\n${archiveList}\n\n` +
      `Recently rejected topics/feedback:\n${rejectionList}`,
    maxTokens: 6144,
  });

  return draft.candidates.filter((c) => c.overlapStatus !== 'already_covered');
}
