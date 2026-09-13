import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { ContentDnaRecord } from '@bb/shared-types';
import { z } from 'zod';

// Spec section 5.6's HOOK/CONTEXT/INSIGHT/MECHANISM/EXAMPLE/SO WHAT/CLOSE/CTA contract,
// expressed as the brand's own house story structure (@bb/core's BRAND_BRAIN.storyStructure
// — see docs/bull-or-bear-brand-voice.md). Exported so editPost.ts's revision prompt
// can reuse it verbatim.
export const LINKEDIN_POST_STRUCTURE = BRAND_BRAIN.storyStructure.join('\n');

// Spec section 5.8.
export const LINKEDIN_HARD_RULES = [
  "Never use another creator's post as the wording template.",
  'Never pretend the creator personally experienced something unless the source material or Content DNA says they did.',
  'Never use an unsupported number.',
  'Never convert an opinion into a fact.',
  'Never use a trend simply because it is trending.',
  'Always preserve editability: write a complete, concrete post, not a fill-in-the-blank template.',
].join('\n');

export const DraftLinkedinPostOutputSchema = z.object({
  hookOptions: z.array(z.string()).min(1).max(3),
  finalPost: z.string().min(1),
  visualSuggestion: z.string().nullable(),
  firstCommentOptional: z.string().nullable(),
  factCheckStatus: z.string(),
  originalityStatus: z.string(),
});
export type DraftLinkedinPostOutput = z.infer<typeof DraftLinkedinPostOutputSchema>;

export interface DraftLinkedinPostInput {
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
  return `You are Agent 01 — the Bull or Bear LinkedIn Thought Leadership Head Agent (spec section 5).

Brand positioning: ${BRAND_BRAIN.positioning.description}
Brand philosophy: ${BRAND_BRAIN.positioning.philosophy}
Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Formatting rules:
${BRAND_BRAIN.voice.formatting.map((f) => `- ${f}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA — write in this voice, blended with the brand voice above:
- Role: ${dna.identity.role}
- Expertise: ${dna.identity.expertise.join(', ') || 'unspecified'}
- Primary audience: ${dna.identity.audiencePrimary}
- Tone: ${dna.voice.tone}
- Preferred phrases: ${dna.voice.preferredPhrases.join(', ') || 'none noted'}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}
- Hook patterns the creator tends to use: ${dna.storytelling.hookPatterns.join(', ') || 'none noted'}

Required post structure (spec 5.6):
${LINKEDIN_POST_STRUCTURE}

Originality rule (spec 5.5): the source is a research lead, not a ghostwriter. Never copy the
source's structure line-for-line, distinctive phrases, jokes, metaphors or conclusion. Add the
creator's own perspective, analysis, example, disagreement or interpretation.

Hard rules (spec 5.8):
${LINKEDIN_HARD_RULES}

Classify every material claim per the taxonomy (FACT / ATTRIBUTED_CLAIM / INTERPRETATION / OPINION /
PREDICTION / UNKNOWN) in your own reasoning before writing. The final post must read naturally, but
must never state an UNKNOWN or PREDICTION as if it were a FACT.`;
}

function buildUserPrompt(input: DraftLinkedinPostInput): string {
  const sourceBlock =
    input.sourceTexts.length > 0
      ? input.sourceTexts.map((text, i) => `--- Source ${i + 1} ---\n${text.slice(0, 4000)}`).join('\n\n')
      : '(no source material supplied — this is an original opinion/analysis post; do not invent facts to fill the gap)';

  return `Topic: ${input.topic}
Angle: ${input.angle}
${input.coreClaim ? `Core claim to address: ${input.coreClaim}\n` : ''}
Source material:
${sourceBlock}

Write one original LinkedIn post for this topic and angle. Respond with the required JSON shape:
hookOptions (1-3 alternative opening hooks for the same post), finalPost (the complete, ready-to-post
text, following the structure above), visualSuggestion (a short description of a supporting visual,
or null), firstCommentOptional (a short first comment that extends the post, or null), factCheckStatus
(one sentence: what in this post is sourced vs. opinion/interpretation), originalityStatus (one
sentence: how this post's angle/wording differs from the source material).`;
}

export async function draftLinkedinPost(input: DraftLinkedinPostInput): Promise<DraftLinkedinPostOutput> {
  return input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    DraftLinkedinPostOutputSchema,
  );
}
