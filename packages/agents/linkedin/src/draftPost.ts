import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import { renderBriefForWriter, STORY_FIRST_WRITING_RULES } from '@bb/editorial-intelligence';
import type { ContentDnaRecord, EditorialBrief } from '@bb/shared-types';
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

// Spec 23 (editorial refactor): LinkedIn's job is STOP -> UNDERSTAND -> THINK, built on
// the same verified core as X and Blog — concrete facts, not corporate filler.
export const LINKEDIN_EDITORIAL_RULES: readonly string[] = [
  'Shape: strong hook, what happened, the interesting detail, why it matters, who is affected, implications, what to watch, optional takeaway.',
  'Use concrete facts from the brief. No generic corporate LinkedIn language: not "In today\'s rapidly changing world", "This is a reminder that", "As we navigate", "Businesses must adapt".',
  'Keep the same verified factual core as every other platform: the same event, dates, numbers, entities, attribution, uncertainty and temporal meaning.',
];

export const DraftLinkedinPostOutputSchema = z.object({
  hookOptions: z.array(z.string()).min(1).max(3),
  finalPost: z.string().min(1),
  visualSuggestion: z.string().nullable(),
  firstCommentOptional: z.string().nullable(),
  factCheckStatus: z.string(),
  originalityStatus: z.string(),
  // The brief claim IDs the opening hook rests on (empty for opinion/no-brief drafts).
  supportingClaimIds: z.array(z.string()).default([]),
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
  // The verified editorial core (spec 20); replaces raw sourceTexts when present.
  editorialBrief?: EditorialBrief | null;
  revisionNotes?: readonly string[];
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

Story-first writing rules:
${STORY_FIRST_WRITING_RULES.map((r) => `- ${r}`).join('\n')}
LinkedIn editorial rules:
${LINKEDIN_EDITORIAL_RULES.map((r) => `- ${r}`).join('\n')}
Priority order, never reversed: factual truth > verified editorial meaning > brand voice > platform
optimisation > engagement.

Classify every material claim per the taxonomy (FACT / ATTRIBUTED_CLAIM / INTERPRETATION / OPINION /
PREDICTION / UNKNOWN) in your own reasoning before writing. The final post must read naturally, but
must never state an UNKNOWN or PREDICTION as if it were a FACT.`;
}

function buildUserPrompt(input: DraftLinkedinPostInput): string {
  const revision =
    input.revisionNotes && input.revisionNotes.length > 0
      ? `\n\nYour previous draft changed the meaning of verified facts. Fix ALL of these:\n${input.revisionNotes.map((n) => `- ${n}`).join('\n')}`
      : '';
  if (input.editorialBrief) {
    return `Angle: ${input.angle}

${renderBriefForWriter(input.editorialBrief)}

Write one original LinkedIn post from this brief: the brief decides WHAT is true and what the story
is; you decide only how to express it on LinkedIn. Open with one of the approved hooks (or a
tightening that keeps every fact and qualifier). Respond with the required JSON shape: hookOptions
(1-3 opening hooks grounded in the brief), finalPost, visualSuggestion (or null),
firstCommentOptional (or null), factCheckStatus (one sentence: what is verified vs. interpretation/
opinion), originalityStatus (one sentence), supportingClaimIds (claim IDs the opening rests on).${revision}`;
  }

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
sentence: how this post's angle/wording differs from the source material).${revision}`;
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
