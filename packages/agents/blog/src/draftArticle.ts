import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { ContentDnaRecord } from '@bb/shared-types';
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

const BlogSectionOutputSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1),
  sourceNote: z.string().nullable(),
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
quotes.`;
}

function buildUserPrompt(input: DraftBlogArticleInput): string {
  const sourceBlock =
    input.sourceTexts.length > 0
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
supplied style baseline).`;
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
