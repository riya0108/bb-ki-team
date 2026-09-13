import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { ContentDnaRecord } from '@bb/shared-types';
import { z } from 'zod';

// Spec section 9.2 — a flexible default, not a mandatory nine-slide rule.
const STANDARD_ARCHITECTURE: readonly string[] = [
  '1. Cover / curiosity hook',
  '2. Set up the problem or surprising fact',
  '3. Explain the first important point',
  '4. Add evidence/example',
  '5. Reveal the twist/mechanism',
  '6. Practical implication',
  '7. Bull vs Bear / comparison / decision point',
  '8. Takeaway',
  '9. CTA / save / share / follow, only if useful',
];

// Spec section 9.4 — the carousel quality test, applied as instructions.
const QUALITY_TEST: readonly string[] = [
  'Can a reader understand the cover without the caption?',
  'Does every slide advance the story?',
  'Can any slide be removed without losing meaning? If yes, remove it.',
  'Is the text readable on a phone?',
  'Are claims traceable?',
  'Does the last slide earn its CTA?',
];

const CarouselSlideOutputSchema = z.object({
  number: z.number().int().positive(),
  headline: z.string().min(1),
  body: z.string().min(1),
  visualDirection: z.string().min(1),
  sourceNote: z.string().nullable(),
});

export const DraftInstagramCarouselOutputSchema = z.object({
  title: z.string().min(1),
  coverHook: z.string().min(1),
  slides: z.array(CarouselSlideOutputSchema).min(1),
  caption: z.string().min(1),
  cta: z.string().nullable(),
  altText: z.string().min(1),
  designSystem: z.string().min(1),
});
export type DraftInstagramCarouselOutput = z.infer<typeof DraftInstagramCarouselOutputSchema>;

export interface DraftInstagramCarouselInput {
  topic: string;
  angle: string;
  coreClaim?: string | null;
  sourceTexts: string[];
  contentDna: ContentDnaRecord;
  llm: LlmClient;
  runId: string;
  stepId: string;
}

function buildSystemPrompt(dna: ContentDnaRecord): string {
  return `You are Instagram Sub-Agent 03B — Carousels (spec section 9). Mission: turn an idea into
a swipeable narrative. Each slide has a job and should make the reader want the next slide.

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

Standard carousel architecture (spec 9.2 — a flexible default, NOT a mandatory nine-slide rule; a
five-slide carousel that cuts every slide that doesn't earn its place is better than a padded one):
${STANDARD_ARCHITECTURE.join('\n')}

Before finalizing, apply the carousel quality test (spec 9.4):
${QUALITY_TEST.map((q) => `- ${q}`).join('\n')}

Never use an unsupported number — sourceNote should cite where a slide's number/claim came from,
or be null if the slide is pure opinion/framing.`;
}

function buildUserPrompt(input: DraftInstagramCarouselInput): string {
  const sourceBlock =
    input.sourceTexts.length > 0
      ? input.sourceTexts.map((text, i) => `--- Source ${i + 1} ---\n${text.slice(0, 4000)}`).join('\n\n')
      : '(no source material supplied — original opinion/analysis; do not invent facts to fill the gap)';

  return `Topic: ${input.topic}
Angle: ${input.angle}
${input.coreClaim ? `Core claim to address: ${input.coreClaim}\n` : ''}
Source material:
${sourceBlock}

Design one Instagram carousel. Respond with the required JSON shape: title (internal working
title), coverHook (slide 1's hook, understandable without the caption), slides (ordered array,
each with number/headline/body/visualDirection/sourceNote — only as many slides as the idea
actually earns), caption, cta (or null), altText (describes the carousel as a whole for
accessibility), designSystem (brief visual/design direction spanning all slides).`;
}

export async function draftInstagramCarousel(
  input: DraftInstagramCarouselInput,
): Promise<DraftInstagramCarouselOutput> {
  return input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    DraftInstagramCarouselOutputSchema,
  );
}
