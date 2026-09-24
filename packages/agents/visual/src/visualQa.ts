import type { LlmClient } from '@bb/core';
import { classifyHighRiskTopic } from '@bb/qa-gate';
import type { VisualClaim, VisualQa, VisualQaStatus } from '@bb/shared-types';
import { VisualQaStatusSchema } from '@bb/shared-types';
import { z } from 'zod';

import { VISUAL_GUARDRAILS } from './visualRules.js';

const LlmVisualQaJudgmentSchema = z.object({
  truthIntegrity: VisualQaStatusSchema,
  evidenceIntegrity: VisualQaStatusSchema,
  identityPrivacy: VisualQaStatusSchema,
  editorialFit: VisualQaStatusSchema,
  platformFit: VisualQaStatusSchema,
  issues: z.array(z.string()),
  requiredFixes: z.array(z.string()),
  reviewerNotes: z.string(),
});

export interface RunVisualQaInput {
  concept: string;
  rationale: string;
  visualClaims: VisualClaim[];
  isIllustrative: boolean;
  disclosureRequired: boolean;
  llm: LlmClient;
  runId: string;
  stepId: string;
}

function worst(statuses: VisualQaStatus[]): VisualQaStatus {
  if (statuses.some((s) => s === 'FAIL')) return 'FAIL';
  if (statuses.some((s) => s === 'NEEDS_REVIEW')) return 'NEEDS_REVIEW';
  return 'PASS';
}

function buildSystemPrompt(): string {
  return `You are the visual QA reviewer for Bull or Bear. Judge the described visual concept
against these guardrails — you are reading a text description of a planned image, not the actual
pixels, so judge only what the description and claims commit to, not visual craft (hands, faces,
anatomy — a human will review the actual rendered image for that separately).

${VISUAL_GUARDRAILS.map((g) => `- ${g}`).join('\n')}

truthIntegrity: FAIL if the concept/claims contradict or go beyond what the listed claims support.
evidenceIntegrity: FAIL if the concept describes fabricating a screenshot, government notice, court
document, financial statement, chart, testimonial, or other evidence artifact as if it were real.
identityPrivacy: FAIL if the concept names or implies a real, identifiable person did something
without support, or exposes private/confidential information.
editorialFit: FAIL if the concept is generic, misleading, or does not communicate the claims'
mechanism/consequence.
platformFit: PASS unless the brief conflicts with itself (e.g. no aspect ratio decided).

Respond with the required JSON shape.`;
}

function buildUserPrompt(input: RunVisualQaInput): string {
  const claimsBlock = input.visualClaims
    .map((c) => `- [${c.claimType}] ${c.claim} (sources: ${c.sourceIds.join(', ') || 'none'})`)
    .join('\n');
  return `Concept: ${input.concept}
Rationale: ${input.rationale}
Is illustrative: ${input.isIllustrative}
Disclosure required: ${input.disclosureRequired}
Visual claims:
${claimsBlock || '(none)'}`;
}

// Truth/evidence/identity/editorial/platform are judged from the brief+claims text
// via the LLM above. visualQuality is deliberately never auto-PASS: the LlmClient
// this repo already has (@bb/core) sends text-only messages, so nothing here can
// actually inspect the generated pixels for hands/faces/artifacts (the skill's own
// visual-qa.md checklist). A human must look at the rendered asset before it can be
// APPROVED — consistent with CLAUDE.md's "human approval before irreversible
// actions" principle rather than faking a check this codebase can't perform.
export async function runVisualQa(input: RunVisualQaInput): Promise<VisualQa> {
  const highRisk = classifyHighRiskTopic(`${input.concept} ${input.rationale}`);

  const judgment = await input.llm.completeStructured(
    {
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
      runId: input.runId,
      stepId: input.stepId,
    },
    LlmVisualQaJudgmentSchema,
  );

  // Deterministic backstop, independent of what the LLM concluded: an illustrative
  // concept must always disclose that fact (SKILL.md: "If an illustrative
  // reconstruction is used, record that fact in metadata").
  const disclosureViolation = input.isIllustrative && !input.disclosureRequired;
  const evidenceIntegrity: VisualQaStatus = disclosureViolation
    ? 'FAIL'
    : judgment.evidenceIntegrity;
  const issues = disclosureViolation
    ? [...judgment.issues, 'Illustrative concept is missing required disclosure metadata.']
    : judgment.issues;

  const visualQuality: VisualQaStatus = 'NEEDS_REVIEW';
  const status = worst([
    judgment.truthIntegrity,
    evidenceIntegrity,
    judgment.identityPrivacy,
    visualQuality,
    judgment.editorialFit,
    judgment.platformFit,
  ]);

  return {
    status,
    truthIntegrity: judgment.truthIntegrity,
    evidenceIntegrity,
    identityPrivacy: judgment.identityPrivacy,
    visualQuality,
    editorialFit: judgment.editorialFit,
    platformFit: judgment.platformFit,
    issues: [...issues, ...highRisk.riskFlags.map((f) => `high-risk topic: ${f}`)],
    requiredFixes: judgment.requiredFixes,
    reviewerNotes:
      judgment.reviewerNotes ||
      'Automated checks reviewed the brief/claims text only; a human must still review the rendered image before approval.',
  };
}
