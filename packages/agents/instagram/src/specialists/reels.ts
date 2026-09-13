import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { ContentDnaRecord } from '@bb/shared-types';
import { z } from 'zod';

// Spec section 10.2.
const REEL_STRUCTURE: readonly string[] = [
  '0-2 seconds: interrupt the scroll.',
  '2-6 seconds: establish the promise/problem.',
  '6-20 seconds: explain or demonstrate.',
  '20-35 seconds: twist, evidence or key insight.',
  'Final seconds: payoff + optional CTA.',
];

// Spec section 10.4.
const REEL_RULES: readonly string[] = [
  'Do not write an article and call it a Reel.',
  'One central idea per Reel.',
  'Put visual proof/context early where possible.',
  'Write spoken language, not essay language.',
  'Use pattern interrupts only when they help comprehension.',
  'Never invent a visual demonstration that implies a false result.',
  "If the user provides a reference video, analyse its structure, not its exact script.",
];

export const DraftInstagramReelOutputSchema = z.object({
  concept: z.string().min(1),
  hook: z.string().min(1),
  spokenScript: z.string().min(1),
  onScreenText: z.array(z.string()).default([]),
  sceneByScene: z.array(z.string()).min(1),
  bRoll: z.array(z.string()).default([]),
  visualProof: z.string().nullable(),
  pacingNotes: z.string().nullable(),
  caption: z.string().min(1),
  coverText: z.string().min(1),
  cta: z.string().nullable(),
  audioNoteOptional: z.string().nullable(),
  editingNotes: z.string().nullable(),
  factSources: z.array(z.string()).default([]),
});
export type DraftInstagramReelOutput = z.infer<typeof DraftInstagramReelOutputSchema>;

export interface DraftInstagramReelInput {
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
  return `You are Instagram Sub-Agent 03C — Reels (spec section 10). Mission: create short-form
vertical video content with an immediate hook, one central idea, visual movement/proof, a payoff
and a purposeful close.

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

Reel structure (spec 10.2):
${REEL_STRUCTURE.map((s) => `- ${s}`).join('\n')}

Rules (spec 10.4):
${REEL_RULES.map((r) => `- ${r}`).join('\n')}

Never use an unsupported number. factSources should cite where each material claim in the spoken
script came from, or be empty if the Reel is pure opinion/framing.`;
}

function buildUserPrompt(input: DraftInstagramReelInput): string {
  const sourceBlock =
    input.sourceTexts.length > 0
      ? input.sourceTexts.map((text, i) => `--- Source ${i + 1} ---\n${text.slice(0, 4000)}`).join('\n\n')
      : '(no source material supplied — original opinion/analysis; do not invent facts to fill the gap)';

  return `Topic: ${input.topic}
Angle: ${input.angle}
${input.coreClaim ? `Core claim to address: ${input.coreClaim}\n` : ''}
Source material:
${sourceBlock}

Write one Reel script. Respond with the required JSON shape: concept (the one central idea),
hook (the 0-2 second line), spokenScript (the full spoken narration, written as spoken language),
onScreenText (array of short on-screen text beats, in order), sceneByScene (ordered array of shot
descriptions matching the script's beats), bRoll (supporting footage ideas, can be empty),
visualProof (a concrete visual demonstration/proof idea, or null), pacingNotes (or null), caption,
coverText (the cover frame's text), cta (or null), audioNoteOptional (or null), editingNotes (or
null), factSources (array, can be empty).`;
}

export async function draftInstagramReel(input: DraftInstagramReelInput): Promise<DraftInstagramReelOutput> {
  return input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    DraftInstagramReelOutputSchema,
  );
}
