import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import { renderBriefForWriter, STORY_FIRST_WRITING_RULES } from '@bb/editorial-intelligence';
import type { ContentDnaRecord, EditorialBrief } from '@bb/shared-types';
import { z } from 'zod';

// Spec section 12.8 — the site's own written editorial observations, used as the
// default style baseline. Spec 12.7: "must learn from the site's actual articles,
// not from generic 'blog style' instructions" — sampleArticleTexts (when supplied)
// supplements or supersedes this baseline rather than the model inventing a style.
const EDITORIAL_OBSERVATIONS: readonly string[] = [
  'Titles frequently use a strong question, tension, surprising claim or practical problem.',
  'Articles aim to explain why something happens, not merely state what happened.',
  'The site uses plain, direct language and avoids unnecessary jargon.',
  'Practical usefulness matters: explainers, comparisons, guides and concrete takeaways.',
  'Preserve the brand\'s independence — never pretend to be a licensed financial, legal or tax adviser.',
];

// Spec 24 (editorial refactor): Blog's job is CLICK -> UNDERSTAND -> EXPLORE -> SEARCH/SHARE.
// More depth than X or LinkedIn, never more facts than the verified claim set.
export const BLOG_EDITORIAL_RULES: readonly string[] = [
  'The title is built on the strongest verified angle from the brief.',
  'The introduction immediately answers: what happened, why it is unusual or important, and why the reader should care.',
  'No textbook filler openings: not "In today\'s fast-paced financial landscape", "The world of finance is constantly evolving", "In recent years".',
  'Go deeper than social posts (mechanism, context, what to watch), but every factual statement must come from the brief\'s verified claims; anything else is clearly labelled interpretation or opinion.',
  'Cite the brief\'s sources near the claims they support, and list them in "sources".',
];

const BlogSectionOutputSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  sourceNote: z.string().nullable(),
});

// Optional visual components matching the Bull or Bear reference article format
// (see htmlBuilder.ts). The model includes one only when the content genuinely
// supports it — never invented to decorate an article that doesn't warrant it — and
// every number/claim inside one is subject to the same sourcing rules as prose.
const ComparisonStatOutputSchema = z.object({
  label: z.string().min(1),
  leftValue: z.string().min(1),
  leftCaption: z.string().min(1),
  rightValue: z.string().min(1),
  rightCaption: z.string().min(1),
  footnote: z.string().min(1),
  afterSectionIndex: z.number().int().min(0),
});

const RevealCardOutputSchema = z.object({
  icon: z.string().min(1),
  teaser: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
});

const RevealCardsOutputSchema = z.object({
  title: z.string().min(1),
  cards: z.array(RevealCardOutputSchema).min(3).max(6),
  afterSectionIndex: z.number().int().min(0),
});

const PollOptionOutputSchema = z.object({
  label: z.string().min(1),
  revealText: z.string().min(1),
});

const PollOutputSchema = z.object({
  question: z.string().min(1),
  options: z.tuple([PollOptionOutputSchema, PollOptionOutputSchema]),
  afterSectionIndex: z.number().int().min(0),
});

const PullQuoteOutputSchema = z.object({
  text: z.string().min(1),
  afterSectionIndex: z.number().int().min(0),
});

export const DraftBlogArticleOutputSchema = z.object({
  titleOptions: z.array(z.string()).min(1).max(3),
  category: z.string().min(1),
  metaDescription: z.string().min(1),
  deck: z.string().min(1),
  thesis: z.string().min(1),
  sections: z.array(BlogSectionOutputSchema).min(2),
  practicalTakeaway: z.string().nullable(),
  conclusion: z.string().min(1),
  disclaimer: z.string().nullable(),
  sources: z.array(z.string()).default([]),
  articleSummary: z.string().min(1),
  estimatedReadTime: z.string().nullable(),
  seoStatus: z.string(),
  styleMatchStatus: z.string(),
  comparisonStat: ComparisonStatOutputSchema.nullable().default(null),
  revealCards: RevealCardsOutputSchema.nullable().default(null),
  poll: PollOutputSchema.nullable().default(null),
  pullQuote: PullQuoteOutputSchema.nullable().default(null),
  // The brief claim IDs the title/introduction rest on (empty for opinion/no-brief drafts).
  supportingClaimIds: z.array(z.string()).default([]),
});
export type DraftBlogArticleOutput = z.infer<typeof DraftBlogArticleOutputSchema>;

export interface DraftBlogArticleInput {
  topic: string;
  articleType: string;
  constraints?: string | null;
  sourceTexts: string[];
  sampleArticleTexts?: string[];
  contentDna: ContentDnaRecord;
  llm: LlmClient;
  runId: string;
  stepId: string;
  // The verified editorial core (spec 20); replaces raw sourceTexts when present.
  editorialBrief?: EditorialBrief | null;
  revisionNotes?: readonly string[];
}

function buildSystemPrompt(dna: ContentDnaRecord, sampleArticleTexts: string[]): string {
  const styleBlock =
    sampleArticleTexts.length > 0
      ? `Sample recent Bull or Bear articles — identify recurring structural and linguistic patterns
across them and apply the common patterns. Do not blindly copy any one article's wording or
outline (spec 12.7):
${sampleArticleTexts.map((t, i) => `--- Sample ${i + 1} ---\n${t.slice(0, 3000)}`).join('\n\n')}`
      : `No live site samples were supplied for this draft — use the site's own written editorial
observations below as the style baseline (spec 12.8):
${EDITORIAL_OBSERVATIONS.map((o) => `- ${o}`).join('\n')}`;

  return `You are Agent 05 — the Bull or Bear Blog HTML Agent (spec section 12). Mission: accept a
topic and produce a finished article that feels like it belongs on Bull or Bear, not generic AI SEO
content.

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

${styleBlock}

Blog article anatomy (spec 12.4):
- Title: specific, curiosity-led, honest and human.
- Deck: one or two sentences explaining what the reader will learn.
- Opening: start with the tension/question, not generic background.
- Body: short sections, clear headings, examples and explanation.
- Evidence: sources near the relevant claim.
- Practical section: what the reader should do/know, when relevant.
- Conclusion: synthesis, implication or changed assumption.
- Disclaimer: only where financial/legal/tax/medical or other regulated subject matter requires it.

Never use an unsupported number. Every material claim must be traceable to the supplied source
material, or clearly framed as opinion/interpretation. Do not invent image URLs, sources, or
quotes.

Story-first writing rules:
${STORY_FIRST_WRITING_RULES.map((r) => `- ${r}`).join('\n')}
Blog editorial rules:
${BLOG_EDITORIAL_RULES.map((r) => `- ${r}`).join('\n')}
Priority order, never reversed: factual truth > verified editorial meaning > brand voice > platform
optimisation > engagement.

Optional visual components — the final HTML is a richly formatted page (styled cards, a
comparison-stat callout, a poll), not a plain wall of text. Include each one only when the
content genuinely supports it — never fabricate a stat or invent a list of "hidden" items just
to fill a component, and every number inside one still needs a real source or must be clearly
your own analysis:
- comparisonStat: a "guess vs. reality" or "before vs. after" style callout with two big numbers
  (e.g. what people estimate vs. what's actually true) and a one-line footnote. Only when the
  source material actually supports a comparison like this.
- revealCards: 3-6 short tap-to-reveal cards (a one-line teaser + a single emoji icon on the
  front, a title + 1-3 sentence explanation on the back) — good for "N things you didn't know"
  style lists that arise naturally from the material.
- poll: a two-option question inviting the reader to self-identify, each option paired with a
  short reveal (a relevant stat or observation) shown after they pick.
- pullQuote: one sentence from the article worth pulling out as a visual quote.
Each component takes an afterSectionIndex (0-based index into "sections") saying which section
it should appear directly after — place it where it fits the argument, not automatically at the
end. Omit (null) any component that doesn't fit this particular article.`;
}

function buildUserPrompt(input: DraftBlogArticleInput): string {
  const revision =
    input.revisionNotes && input.revisionNotes.length > 0
      ? `\n\nYour previous draft changed the meaning of verified facts. Fix ALL of these:\n${input.revisionNotes.map((n) => `- ${n}`).join('\n')}`
      : '';
  const sourceBlock = input.editorialBrief
    ? `${renderBriefForWriter(input.editorialBrief)}

The brief decides WHAT is true and what the story is; you decide only how to express it as a Bull
or Bear article. Build the title on the selected angle and open with the strongest verified fact.`
    : input.sourceTexts.length > 0
      ? input.sourceTexts.map((text, i) => `--- Source ${i + 1} ---\n${text.slice(0, 8000)}`).join('\n\n')
      : '(no source material supplied — original opinion/analysis; do not invent facts to fill the gap)';

  return `Topic: ${input.topic}
Article type: ${input.articleType} (spec 12.2's blog modes)
${input.constraints ? `Constraints: ${input.constraints}\n` : ''}
Source material:
${sourceBlock}

Write one Bull or Bear article. Respond with the required JSON shape: titleOptions (1-3 honest,
curiosity-led options), category, metaDescription, deck, thesis (the article's one-sentence
argument — internal, not rendered), sections (ordered array, each an H2 with heading/body/
sourceNote — body is plain text, paragraphs separated by a blank line), practicalTakeaway (or
null), conclusion, disclaimer (or null — only for regulated subject matter), sources (array,
can be empty), articleSummary (a concise editorial summary of the piece), estimatedReadTime (e.g.
"5 min", or null), seoStatus (one sentence), styleMatchStatus (one sentence: how this matches the
supplied style baseline), comparisonStat/revealCards/poll/pullQuote (each null unless the content
genuinely supports it — see the visual components guidance above), supportingClaimIds (claim IDs
from the editorial brief that the title and introduction rest on, or an empty list).${revision}`;
}

export async function draftBlogArticle(input: DraftBlogArticleInput): Promise<DraftBlogArticleOutput> {
  return input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna, input.sampleArticleTexts ?? []),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    DraftBlogArticleOutputSchema,
  );
}
