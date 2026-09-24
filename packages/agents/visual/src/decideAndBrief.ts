import type { LlmClient } from '@bb/core';
import {
  GenerationBriefSchema,
  VisualClaimSchema,
  VisualDecisionSchema,
  VisualSourceModeSchema,
  VisualTypeSchema,
} from '@bb/shared-types';
import { z } from 'zod';

import {
  HIGH_RISK_VISUAL_TOPICS,
  VISUAL_DECISION_PRIORITY,
  VISUAL_GUARDRAILS,
  VISUAL_STYLE_AVOID,
  VISUAL_STYLE_PREFERENCES,
} from './visualRules.js';

export const DecideAndBriefOutputSchema = z.object({
  visualDecision: VisualDecisionSchema,
  visualType: VisualTypeSchema,
  concept: z.string().min(1),
  rationale: z.string().min(1),
  sourceMode: VisualSourceModeSchema,
  isIllustrative: z.boolean(),
  disclosureRequired: z.boolean(),
  generationBrief: GenerationBriefSchema,
  visualClaims: z.array(VisualClaimSchema),
  fictionalOrIllustrativeElements: z.array(z.string()),
  riskFlags: z.array(z.string()),
});
export type DecideAndBriefOutput = z.infer<typeof DecideAndBriefOutputSchema>;

export interface DecideAndBriefInput {
  contentId: string;
  platform: string;
  topic: string | null;
  coreClaim: string | null;
  currentText: string;
  sourceUrls: string[];
  llm: LlmClient;
  runId: string;
  stepId: string;
}

function buildSystemPrompt(): string {
  return `You are the Visual Production Agent inside BB-ki-Team (Bull or Bear). You are an
additive specialist: you never rewrite the approved text, never invent facts, and never decide
publication — a human approves every visual separately.

Permanent guardrails:
${VISUAL_GUARDRAILS.map((g) => `- ${g}`).join('\n')}

Visual job priority (choose the strongest that fits; prefer earlier entries):
${VISUAL_DECISION_PRIORITY.map((p, i) => `${i + 1}. ${p}`).join('\n')}

If the story depends on a real source artifact (an actual government notice, court document,
financial statement, app screenshot, product label, real chart, or event photograph), you MUST
return visualDecision "REAL_ASSET_REQUIRED" — never recreate that artifact with AI and imply it is
original.

Style preferences: ${VISUAL_STYLE_PREFERENCES.join(', ')}.
Avoid: ${VISUAL_STYLE_AVOID.join(', ')}.
Default textOnImage to "none" unless text is short, readable and factually supported.

High-risk topics requiring mandatory human approval before any visual is used: ${HIGH_RISK_VISUAL_TOPICS.join(', ')}.
If the content touches any of these, say so explicitly in riskFlags.

Every visualClaim you list must be classified (verified_fact / attributed_claim / interpretation /
opinion / prediction / illustrative) and, for verified_fact/attributed_claim, backed by a
sourceId from the sources given to you — never invent a source. isIllustrative and
disclosureRequired must be set truthfully: any AI-generated scene depicting an event, person, or
document must be marked illustrative with disclosure required unless it is purely conceptual
artwork with no claim to documentary reality.

If a visual is not useful for this content, return visualDecision "NOT_APPROPRIATE" and still fill
every other required field with an honest, minimal, non-fabricated value.`;
}

function buildUserPrompt(input: DecideAndBriefInput): string {
  return `Platform: ${input.platform}
Topic: ${input.topic ?? '(none recorded)'}
Core claim: ${input.coreClaim ?? '(none recorded)'}
Sources: ${input.sourceUrls.length > 0 ? input.sourceUrls.join(', ') : '(none recorded)'}

Approved content text (read only — do not rewrite it, do not add facts not present here or in the
sources above):
${input.currentText.slice(0, 6000)}

Decide the visual job for this content and produce a complete generation brief. Respond with the
required JSON shape.`;
}

export async function decideAndBrief(input: DecideAndBriefInput): Promise<DecideAndBriefOutput> {
  return input.llm.completeStructured(
    {
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    DecideAndBriefOutputSchema,
  );
}
