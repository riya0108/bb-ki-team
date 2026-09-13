import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { ContentDnaRecord } from '@bb/shared-types';
import { z } from 'zod';

// Spec section 11.1 — Shorts-specific optimisation, verbatim.
const SHORTS_OPTIMISATION: readonly string[] = [
  'The opening must establish a clear information promise extremely quickly.',
  'The script should reward continued watching with progressive information.',
  'Use visual changes because they help the viewer follow the explanation, not merely because the video needs motion.',
  'The title should describe the actual value or curiosity gap of the Short.',
  'The description can provide context, sources or a concise next step.',
  'Use search-relevant language naturally without keyword stuffing.',
  "A Short should make sense even if discovered without the creator's other content.",
  'If the source is a long video, choose the strongest self-contained idea rather than automatically cutting the first segment.',
];

// Spec section 11.4 — the retention QA test, applied as drafting instructions.
const RETENTION_QA: readonly string[] = [
  'Does the first sentence create a reason to stay?',
  'Is there a new piece of information every few seconds or at each meaningful beat?',
  'Is the payoff stronger than the setup?',
  'Could any sentence be removed without harming comprehension?',
];

export const DraftYoutubeShortOutputSchema = z.object({
  corePromise: z.string().min(1),
  hookOptions: z.array(z.string()).min(1).max(3),
  titleOptions: z.array(z.string()).min(1).max(3),
  spokenScript: z.string().min(1),
  visualBeats: z.array(z.string()).min(1),
  onScreenText: z.array(z.string()).default([]),
  bRoll: z.array(z.string()).default([]),
  editingPacing: z.string().nullable(),
  description: z.string().min(1),
  cta: z.string().nullable(),
});
export type DraftYoutubeShortOutput = z.infer<typeof DraftYoutubeShortOutputSchema>;

export interface DraftYoutubeShortInput {
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
  return `You are Agent 04 — the Bull or Bear YouTube Shorts Content Head Agent (spec section 11).
The Shorts Agent shares the short-form storytelling discipline of the Instagram Reel Agent but is
independently optimised for YouTube — never simply paste an Instagram Reel script into Shorts.

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

Shorts-specific optimisation (spec 11.1):
${SHORTS_OPTIMISATION.map((s) => `- ${s}`).join('\n')}

Build a retention arc: promise -> setup -> escalation -> reveal -> payoff (spec 11.2). Before
finalizing, apply the retention QA test (spec 11.4):
${RETENTION_QA.map((q) => `- ${q}`).join('\n')}

Never use an unsupported number. Every material claim in the spoken script must be traceable to
the supplied source material, or clearly framed as opinion/interpretation.`;
}

function buildUserPrompt(input: DraftYoutubeShortInput): string {
  const sourceBlock =
    input.sourceTexts.length > 0
      ? input.sourceTexts.map((text, i) => `--- Source ${i + 1} ---\n${text.slice(0, 6000)}`).join('\n\n')
      : '(no source material supplied — original opinion/analysis; do not invent facts to fill the gap)';

  return `Topic: ${input.topic}
Angle: ${input.angle}
${input.coreClaim ? `Core claim to address: ${input.coreClaim}\n` : ''}
Source material:
${sourceBlock}

Write one YouTube Short production package for this topic and angle — one self-contained idea,
understandable even without the creator's other content. Respond with the required JSON shape:
corePromise (the one thing this Short delivers on), hookOptions (1-3 alternative opening lines),
titleOptions (1-3 alternative titles describing the actual value/curiosity gap), spokenScript (the
full narration, written as spoken language), visualBeats (ordered array of shot/visual descriptions
matching the script's beats), onScreenText (array of on-screen text beats, can be empty),
bRoll (supporting footage ideas, can be empty), editingPacing (brief pacing notes, or null),
description (the video description: context/sources/next step), cta (or null if none serves a
purpose).`;
}

export async function draftYoutubeShort(input: DraftYoutubeShortInput): Promise<DraftYoutubeShortOutput> {
  return input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    DraftYoutubeShortOutputSchema,
  );
}
