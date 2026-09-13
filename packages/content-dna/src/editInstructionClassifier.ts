import type { LlmClient } from '@bb/core';
import type { ContentDnaRecord } from '@bb/shared-types';
import { z } from 'zod';

// Mirrors ContentDnaBodySchema's sections, but every field is optional (a patch
// touches only what changed) — see mergeProposedChange in learningEvents.ts, which
// shallow-merges each present section over the current DNA. Array fields there are
// replaced wholesale, not appended, so the prompt below tells the model to include
// full replacement arrays rather than just the delta.
const ProposedDnaPatchSchema = z.object({
  identity: z
    .object({
      role: z.string().optional(),
      expertise: z.array(z.string()).optional(),
      audiencePrimary: z.string().optional(),
      audienceSecondary: z.string().optional(),
    })
    .optional(),
  topics: z
    .object({
      primary: z.array(z.string()).optional(),
      secondary: z.array(z.string()).optional(),
      avoid: z.array(z.string()).optional(),
    })
    .optional(),
  opinions: z
    .object({
      stronglyHeld: z.array(z.string()).optional(),
      nuanced: z.array(z.string()).optional(),
      evolving: z.array(z.string()).optional(),
      unknown: z.array(z.string()).optional(),
    })
    .optional(),
  voice: z
    .object({
      tone: z.string().optional(),
      energy: z.string().optional(),
      formality: z.string().optional(),
      humour: z.string().optional(),
      directness: z.string().optional(),
      sentenceRhythm: z.string().optional(),
      paragraphRhythm: z.string().optional(),
      vocabulary: z.array(z.string()).optional(),
      preferredPhrases: z.array(z.string()).optional(),
      forbiddenPhrases: z.array(z.string()).optional(),
    })
    .optional(),
  storytelling: z
    .object({
      hookPatterns: z.array(z.string()).optional(),
      analogyPatterns: z.array(z.string()).optional(),
      evidenceStyle: z.string().optional(),
      conclusionStyle: z.string().optional(),
      ctaPatterns: z.array(z.string()).optional(),
    })
    .optional(),
});
export type ProposedDnaPatch = z.infer<typeof ProposedDnaPatchSchema>;

const EditInstructionClassificationSchema = z.object({
  isVoiceLevelInstruction: z.boolean(),
  summary: z.string(),
  proposedChange: ProposedDnaPatchSchema.nullable(),
});
export type EditInstructionClassification = z.infer<typeof EditInstructionClassificationSchema>;

function buildSystemPrompt(dna: ContentDnaRecord): string {
  return `You classify an edit instruction a creator gave while revising one post, for the
Learning Loop (spec section 16). Decide whether this instruction is:
- A one-off change specific to only this post (e.g. "cut the last paragraph", "make this
  about X instead of Y", "shorten this") -> isVoiceLevelInstruction: false, proposedChange: null.
- A general voice/style preference that should apply to ALL future posts (e.g. "never use
  exclamation marks", "always mention UPI when relevant", "stop starting posts with a
  question", "don't call me an expert") -> isVoiceLevelInstruction: true, with a proposedChange
  patch.

Never invent a voice-level instruction from content-specific feedback. When in doubt, treat it
as one-off (spec 3.4: never rewrite Content DNA from a single one-off edit).

If isVoiceLevelInstruction is true, proposedChange must patch only the sections actually
affected. Array fields (identity.expertise, topics.*, opinions.*, voice.vocabulary/
preferredPhrases/forbiddenPhrases, storytelling.*) are REPLACED wholesale when applied, not
appended — so include the existing values below plus the new addition/removal, not just the
new item alone.

Current Content DNA (for computing full replacement arrays):
${JSON.stringify(
  {
    identity: dna.identity,
    topics: dna.topics,
    opinions: dna.opinions,
    voice: dna.voice,
    storytelling: dna.storytelling,
  },
  null,
  2,
)}`;
}

export async function classifyEditInstruction(
  instruction: string,
  dna: ContentDnaRecord,
  llm: LlmClient,
  runId: string,
): Promise<EditInstructionClassification> {
  return llm.completeStructured(
    {
      system: buildSystemPrompt(dna),
      messages: [{ role: 'user', content: `Edit instruction: ${instruction}` }],
      runId,
      stepId: 'classify-edit-instruction',
    },
    EditInstructionClassificationSchema,
  );
}
