import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { ContentDnaRecord } from '@bb/shared-types';
import { z } from 'zod';

// Spec section 6.2 — X-native principles, verbatim as instructions.
export const X_NATIVE_PRINCIPLES: readonly string[] = [
  'Compression without losing the argument.',
  'One strong idea beats five weak ideas.',
  'The first post of a thread must work independently.',
  'Every subsequent post must add new information, evidence, contrast or progression.',
  "Avoid generic 'here are 7 lessons' packaging unless the idea genuinely warrants it.",
  'Use numbers and contrasts when they make the thought clearer.',
  'Do not force a thread when one post is stronger.',
  'Do not simply translate LinkedIn wording into X wording.',
];

export const XModeDecisionSchema = z.enum(['single', 'thread']);
export type XModeDecision = z.infer<typeof XModeDecisionSchema>;

export const DraftXOutputSchema = z.object({
  mode: XModeDecisionSchema,
  hookOptions: z.array(z.string()).min(1).max(3),
  finalCopy: z.string().min(1),
  // Populated only when mode === 'thread'; finalCopy still holds the first post so
  // every draft has one consistent "the primary text" field (mirrors XPackageSchema).
  threadPosts: z.array(z.string()).nullable(),
  factCheckStatus: z.string(),
});
export type DraftXOutput = z.infer<typeof DraftXOutputSchema>;

export interface DraftXPostInput {
  topic: string;
  angle: string;
  coreClaim?: string | null;
  sourceTexts: string[];
  contentDna: ContentDnaRecord;
  llm: LlmClient;
  runId: string;
  stepId: string;
  // Force a shape rather than letting the model decide (spec 6.1's distinct
  // "Single-post mode" / "Thread mode" vs. discovery/repurpose flows where the model
  // makes the single-vs-thread call itself, per spec 6.3).
  forceMode?: XModeDecision;
}

function buildSystemPrompt(dna: ContentDnaRecord, forceMode: XModeDecision | undefined): string {
  const modeInstruction =
    forceMode === 'single'
      ? 'Write this as a SINGLE post. Do not produce a thread even if the idea could support one.'
      : forceMode === 'thread'
        ? 'Write this as a THREAD. Even a short thread must justify itself: the first post must work standalone, and every later post must add something new.'
        : 'Decide whether this idea is stronger as one post or a thread (spec 6.3). Do not force a thread when one post is stronger.';

  return `You are Agent 02 — the Bull or Bear X (Twitter) Content Head Agent (spec section 6).
Mission: create sharp, native X content that feels like a person with a point of view, not a
LinkedIn post cut into shorter lines.

Brand positioning: ${BRAND_BRAIN.positioning.description}
Brand philosophy: ${BRAND_BRAIN.positioning.philosophy}
Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Formatting rules:
${BRAND_BRAIN.voice.formatting.map((f) => `- ${f}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

X-native principles (spec 6.2):
${X_NATIVE_PRINCIPLES.map((p) => `- ${p}`).join('\n')}

Creator's Content DNA — write in this voice, blended with the brand voice above:
- Role: ${dna.identity.role}
- Tone: ${dna.voice.tone}
- Preferred phrases: ${dna.voice.preferredPhrases.join(', ') || 'none noted'}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

${modeInstruction}

Determine the content job first (explain, react, teach, challenge, observe or entertain — spec
6.3), then write accordingly. Originality rule (spec 5.5, applies across platforms): never copy a
source's structure, distinctive phrasing, or conclusion line-for-line — add the creator's own
perspective, analysis, example or disagreement.

Classify every material claim per the taxonomy (FACT / ATTRIBUTED_CLAIM / INTERPRETATION / OPINION /
PREDICTION / UNKNOWN) in your own reasoning before writing. Never state an UNKNOWN or PREDICTION as
if it were a FACT. Never use an unsupported number.`;
}

function buildUserPrompt(input: DraftXPostInput): string {
  const sourceBlock =
    input.sourceTexts.length > 0
      ? input.sourceTexts.map((text, i) => `--- Source ${i + 1} ---\n${text.slice(0, 4000)}`).join('\n\n')
      : '(no source material supplied — this is an original opinion/analysis post; do not invent facts to fill the gap)';

  return `Topic: ${input.topic}
Angle: ${input.angle}
${input.coreClaim ? `Core claim to address: ${input.coreClaim}\n` : ''}
Source material:
${sourceBlock}

Write the X content for this topic and angle. Respond with the required JSON shape: mode ("single"
or "thread"), hookOptions (1-3 alternative opening lines for the same post/thread), finalCopy (the
complete text — the single post, or the first post of the thread), threadPosts (the full ordered
array of thread posts including the first one, or null if mode is "single"), factCheckStatus (one
sentence: what is sourced vs. opinion/interpretation).`;
}

export async function draftXPost(input: DraftXPostInput): Promise<DraftXOutput> {
  const result = await input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna, input.forceMode),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    DraftXOutputSchema,
  );

  // Defense-in-depth: never trust the model to obey forceMode unprompted. If it
  // ignores an explicit forceMode, force the shape to stay internally consistent
  // rather than surface a mode/threadPosts mismatch to callers.
  if (input.forceMode === 'single' && result.mode !== 'single') {
    return { ...result, mode: 'single', threadPosts: null };
  }
  if (input.forceMode === 'thread' && result.mode !== 'thread') {
    return { ...result, mode: 'thread', threadPosts: result.threadPosts ?? [result.finalCopy] };
  }
  return result;
}
