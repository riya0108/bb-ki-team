import { z } from 'zod';
import type { ResearchPack } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import type { StyleSample } from '../mcpClient.js';

const DraftContentSchema = z.object({
  title: z.string().min(1),
  /** A slightly more search-friendly variant of the title, if it genuinely differs — otherwise omit. */
  seoTitle: z.string().min(1).optional(),
  excerpt: z.string().min(1),
  content: z.string().min(1),
});

export type DraftContent = z.infer<typeof DraftContentSchema>;

function formatResearchPack(pack: ResearchPack): string {
  const facts = pack.facts.map(
    (f) => `- ${f.claim}${f.value ? ` (${f.value})` : ''} [${f.sourceType}] (source: ${f.source})`,
  );
  const statistics = pack.statistics.map(
    (s) => `- ${s.stat}${s.value ? ` (${s.value})` : ''} [${s.sourceType}] (source: ${s.source})`,
  );
  const quotes = pack.expertQuotes.map((q) => `- "${q.quote}" — ${q.attribution} (source: ${q.source})`);
  const structure = pack.recommendedStructure.map((s, i) => `${String(i + 1)}. ${s}`);

  return [
    `Why this matters (the hook): ${pack.causalAnalysis.whatHappened} ${pack.causalAnalysis.whyItHappened} Who's affected: ${pack.causalAnalysis.whoIsAffected}`,
    pack.historicalPrecedent.length > 0
      ? `Historical precedent:\n${pack.historicalPrecedent
          .map((h) => `- ${h.similarEvent} → ${h.outcome}. What's different now: ${h.whatsDifferentNow}`)
          .join('\n')}`
      : '',
    `Steelmanned counterargument (the dominant narrative is: "${pack.counterargument.dominantNarrative}"): ${pack.counterargument.strongestCounterEvidence} (source: ${pack.counterargument.source})`,
    `Content gap vs. competitors: they covered "${pack.contentGap.whatCompetitorsCovered}" but missed "${pack.contentGap.whatsMissing}". Our angle: ${pack.contentGap.recommendedAngle}`,
    `Facts (background sources are [background] — context only, not citation-worthy on their own):\n${facts.length > 0 ? facts.join('\n') : '(none)'}`,
    `Statistics:\n${statistics.length > 0 ? statistics.join('\n') : '(none)'}`,
    `Expert quotes:\n${quotes.length > 0 ? quotes.join('\n') : '(none)'}`,
    `Research agent's suggested talking points (raw material for the sections below, not a literal heading list):\n${structure.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatStyleSamples(samples: StyleSample[]): string {
  if (samples.length === 0) {
    return '(No prior posts available to reference — write in a sharp, direct, editorial voice.)';
  }
  return samples
    .map((s, i) => `Sample ${String(i + 1)} — "${s.title}":\n${s.bodyExcerpt}`)
    .join('\n\n---\n\n');
}

const SYSTEM_PROMPT =
  'You are a blog Content Writer for a finance/tech publication — write like a sharp investigative ' +
  'journalist and editor, not an encyclopedia entry. Write ONLY from the research pack you are given — ' +
  'every non-obvious factual claim, statistic, or quote in your draft must come from that pack, and ' +
  '[background]-tagged items (Wikipedia) are context/orientation only, never presented as a ' +
  'citation-worthy fact on their own. Never invent a fact, statistic, quote, or source not present ' +
  'in the pack (CLAUDE.md: never fabricate facts). Distinguish FACT, ESTIMATE, and OPINION/ALLEGATION ' +
  'when the pack\'s confidence is low or a claim is contested (the counterargument) — hedge honestly ' +
  '("according to X…", "this remains unconfirmed") rather than stating everything with equal certainty. ' +
  "Every important number needs context, not just the figure — what it represents, over what period, " +
  "whose estimate it is.\n\n" +
  'STRUCTURE — follow this arc precisely, using ## for each named section that applies (skip a section ' +
  "only if the research pack genuinely has nothing for it — never pad):\n" +
  "1. HOOK: no heading, just the opening 1-3 paragraphs. Open with the event, a striking number, a human " +
  'consequence, a sharp question, or a contradiction — never a generic line like "In today\'s ' +
  'fast-changing world...". Assume the reader knows nothing about this topic yet. If it genuinely ' +
  'strengthens the hook, you may include ONE short provocative question or lightweight poll-style line ' +
  "near the top (e.g. \"Which side are you on?\") — use this sparingly, only when it truly fits, never " +
  "force it.\n" +
  '2. CONTEXT (## Background or a topic-specific heading): the minimum a first-time reader needs — ' +
  "terms, history, prior events — before the current story makes sense.\n" +
  '3. WHAT HAPPENED (## heading): the central explanation — what, where, when, who, what\'s confirmed ' +
  "vs. still unclear.\n" +
  '4. WHY (## heading): the causal chain behind it — not just "the reason was X" but A led to B led to ' +
  "C.\n" +
  '5. NUMBERS (## heading, only if the pack has statistics worth a dedicated section): the figures that ' +
  "matter, each with source and context.\n" +
  '6. STAKEHOLDERS (## heading): who is affected and how, drawing on causalAnalysis.whoIsAffected and ' +
  "historical precedent where it genuinely adds depth.\n" +
  '7. WHAT PEOPLE ARE MISSING (## heading): the content gap\'s recommended angle and the steelmanned ' +
  "counterargument — this is what separates the piece from a generic recap, not a throwaway aside.\n" +
  '8. REAL-WORLD IMPACT (## heading): answers "so what?" for the reader directly.\n' +
  '9. WHAT HAPPENS NEXT (## heading): evidence-based next steps only — "the most likely next step is…", ' +
  '"officials have indicated…" — never an unsupported prediction.\n' +
  '10. TAKEAWAY (## heading, e.g. "## The Bottom Line"): a genuine synthesis, not a restatement of the ' +
  "hook. If a natural call-to-action fits earlier in the piece (roughly a third to halfway through), a " +
  "single understated line is fine — don't force one at the very end.\n\n" +
  'LENGTH: aim for 900-2000 words. 900 is a floor, not a target to just clear — write everything the ' +
  'story needs. 2000 is a soft ceiling: only go past it if the topic genuinely cannot be told properly ' +
  "in less. Don't pad to hit a number and don't compress a story that needs more room.\n\n" +
  "VOICE: match the house style shown in the reference samples below — direct address, bolded key " +
  'phrases used sparingly for emphasis, natural inline Markdown links, occasional bullet lists for ' +
  "scannability but not every paragraph turned into one. Avoid generic AI-sounding filler, hedging for " +
  "its own sake, and listicle-recap voice — write to be read to the end.";

export interface WriteDraftOptions {
  styleSamples: StyleSample[];
}

export async function writeDraft(
  providers: LlmProviderConfig[],
  topic: string,
  researchPack: ResearchPack,
  options: WriteDraftOptions,
  modificationNote?: string,
): Promise<DraftContent> {
  const prompt =
    `Approved topic: "${topic}"` +
    (modificationNote ? `\nEditor's note: "${modificationNote}"` : '') +
    `\n\nResearch pack:\n${formatResearchPack(researchPack)}` +
    `\n\nHouse style reference (match tone/voice, not the topic):\n${formatStyleSamples(options.styleSamples)}` +
    `\n\nWrite the blog post.`;

  return generateStructured({
    providers,
    toolName: 'blog_draft',
    schema: DraftContentSchema,
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 6000,
  });
}

export async function reviseDraft(
  providers: LlmProviderConfig[],
  topic: string,
  researchPack: ResearchPack,
  previousContent: string,
  feedback: string,
  options: WriteDraftOptions,
  modificationNote?: string,
): Promise<DraftContent> {
  const prompt =
    `Approved topic: "${topic}"` +
    (modificationNote ? `\nEditor's note: "${modificationNote}"` : '') +
    `\n\nResearch pack:\n${formatResearchPack(researchPack)}` +
    `\n\nHouse style reference (match tone/voice, not the topic):\n${formatStyleSamples(options.styleSamples)}` +
    `\n\nExisting draft (Markdown):\n${previousContent}` +
    `\n\nRequested changes: "${feedback}"` +
    '\n\nRevise the existing draft to address the requested changes. Keep everything that already ' +
    'works — this is an edit, not a rewrite from scratch — and stay grounded in the same research pack.';

  return generateStructured({
    providers,
    toolName: 'blog_draft',
    schema: DraftContentSchema,
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 6000,
  });
}
