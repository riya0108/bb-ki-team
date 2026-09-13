import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { ContentDnaRecord } from '@bb/shared-types';
import { z } from 'zod';

// Spec section 8.3.
const POST_RULES: readonly string[] = [
  'One visual idea per post.',
  'Readable at mobile size.',
  'Avoid stuffing the image with paragraph-length text.',
  'Caption should add context rather than repeat the graphic.',
  'CTA must be appropriate to the content job.',
  'If a number is used visually, preserve the source and date.',
];

export const DraftInstagramPostOutputSchema = z.object({
  concept: z.string().min(1),
  visualDirection: z.string().min(1),
  coverText: z.string().min(1),
  headline: z.string().min(1),
  caption: z.string().min(1),
  firstLineHook: z.string().min(1),
  cta: z.string().nullable(),
  hashtagsOptional: z.array(z.string()).default([]),
  altText: z.string().min(1),
  designNotes: z.string().min(1),
});
export type DraftInstagramPostOutput = z.infer<typeof DraftInstagramPostOutputSchema>;

export interface DraftInstagramPostInput {
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
  return `You are Instagram Sub-Agent 03A — Single Posts (spec section 8). Mission: create
single-image/feed posts that communicate one idea quickly and pair it with a useful caption. The
post should not look like a screenshot of a blog.

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

Rules (spec 8.3):
${POST_RULES.map((r) => `- ${r}`).join('\n')}

Never use an unsupported number. If a number appears on the visual, it must be traceable to the
supplied source material.`;
}

function buildUserPrompt(input: DraftInstagramPostInput): string {
  const sourceBlock =
    input.sourceTexts.length > 0
      ? input.sourceTexts.map((text, i) => `--- Source ${i + 1} ---\n${text.slice(0, 4000)}`).join('\n\n')
      : '(no source material supplied — original opinion/analysis; do not invent facts to fill the gap)';

  return `Topic: ${input.topic}
Angle: ${input.angle}
${input.coreClaim ? `Core claim to address: ${input.coreClaim}\n` : ''}
Source material:
${sourceBlock}

Design one Instagram single post. Respond with the required JSON shape: concept (one sentence:
the single visual idea), visualDirection (what the image should show), coverText (short text
overlaid on the image), headline (the visual's headline, distinct from coverText if useful),
caption (the post caption, adds context rather than repeating the graphic), firstLineHook (the
caption's first line — must earn the "more" tap), cta (or null if none serves a purpose),
hashtagsOptional (array, can be empty), altText (accessibility description of the image),
designNotes (brief production notes for whoever builds the graphic).`;
}

export async function draftInstagramPost(input: DraftInstagramPostInput): Promise<DraftInstagramPostOutput> {
  return input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    DraftInstagramPostOutputSchema,
  );
}
