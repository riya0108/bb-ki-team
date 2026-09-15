import type { LlmClient } from '@bb/core';
import type { ContentDnaRecord, ContentStatus, QaDimensionResult, QaResult } from '@bb/shared-types';

import { checkEmDash } from './deterministic/emDash.js';
import { checkForbiddenPhrases } from './deterministic/forbiddenPhrases.js';
import { classifyHighRiskTopic } from './deterministic/highRiskTopic.js';
import { checkPersonalExperience } from './deterministic/personalExperience.js';
import { checkPrivacy } from './deterministic/privacy.js';
import { checkSourceIntegrity } from './deterministic/sourceIntegrity.js';
import { checkApprovalState, checkEditability, checkPublishing } from './deterministic/trivialChecks.js';
import { checkUnsupportedNumbers } from './deterministic/unsupportedNumbers.js';
import {
  checkClarity,
  checkHookHonesty,
  checkOriginality,
  checkPlatformFit,
  checkVoiceMatchRubric,
} from './rubric.js';

export * from './deterministic/emDash.js';
export * from './deterministic/forbiddenPhrases.js';
export * from './deterministic/highRiskTopic.js';
export * from './deterministic/personalExperience.js';
export * from './deterministic/privacy.js';
export * from './deterministic/sourceIntegrity.js';
export * from './deterministic/trivialChecks.js';
export * from './deterministic/unsupportedNumbers.js';
export * from './rubric.js';

export interface RunQaGateInput {
  finalPost: string;
  sourceReferences: string[];
  sourceTexts: string[];
  contentDna: ContentDnaRecord;
  status: ContentStatus;
  llm: LlmClient;
  runId: string;
  stepId: string;
  // Human-readable label passed straight through to the rubric checks (e.g.
  // 'LinkedIn', 'X', 'Instagram caption') — see RubricCheckInput.platform.
  platform: string;
}

function worstStatus(results: QaDimensionResult[]): 'PASS' | 'PASS_WITH_WARNINGS' | 'BLOCKED' {
  if (results.some((r) => r.status === 'FAIL')) return 'BLOCKED';
  if (results.some((r) => r.status === 'WARN')) return 'PASS_WITH_WARNINGS';
  return 'PASS';
}

function requiredActionsFrom(name: string, result: QaDimensionResult): string[] {
  if (result.status === 'PASS') return [];
  return [`${name}: ${result.notes}`];
}

// Combines every deterministic check and LLM rubric check into the section 14.3 QA
// output contract. BLOCKED if any dimension fails, PASS_WITH_WARNINGS if any warns,
// else PASS. publishAllowed is always false in Phase 1 — there is no publish
// connector at all, so this can't help but satisfy spec section 15.4.
export async function runQaGate(input: RunQaGateInput): Promise<QaResult> {
  const { finalPost, sourceReferences, sourceTexts, contentDna, status, llm, runId, stepId, platform } = input;

  const { riskLevel, riskFlags: topicRiskFlags } = classifyHighRiskTopic(finalPost);
  const isHighRisk = riskLevel === 'high';

  const claimIntegrity = checkUnsupportedNumbers(finalPost, sourceTexts, isHighRisk);
  const sourceIntegrity = checkSourceIntegrity(finalPost, sourceReferences);
  const emDash = checkEmDash(finalPost);
  const forbiddenPhrases = checkForbiddenPhrases(finalPost, contentDna.voice.forbiddenPhrases);
  const personalExperience = checkPersonalExperience(
    finalPost,
    contentDna.personalContext.approvedExperiences,
    contentDna.personalContext.approvedStories,
  );
  const privacy = checkPrivacy(finalPost, contentDna.personalContext.sensitiveOrPrivate);
  const editability = checkEditability(finalPost);
  const approvalState = checkApprovalState(status);
  const publishing = checkPublishing();

  const rubricInput = { finalPost, sourceTexts, dna: contentDna, llm, runId, stepId, platform };
  const [voiceMatchRubric, originality, platformFit, clarity, hookHonesty] = await Promise.all([
    checkVoiceMatchRubric(rubricInput),
    checkOriginality(rubricInput),
    checkPlatformFit(rubricInput),
    checkClarity(rubricInput),
    checkHookHonesty(rubricInput),
  ]);

  // Deterministic em-dash/forbidden-phrase checks are folded into voice_match: an
  // LLM PASS cannot override a mechanical rule violation.
  const voiceMatch: QaDimensionResult =
    emDash.status === 'FAIL' || forbiddenPhrases.status === 'FAIL'
      ? {
          status: 'FAIL',
          notes: [emDash, forbiddenPhrases].filter((r) => r.status === 'FAIL').map((r) => r.notes).join(' '),
          evidence: [...(emDash.evidence ?? []), ...(forbiddenPhrases.evidence ?? [])],
        }
      : voiceMatchRubric;

  const dimensions: Record<string, QaDimensionResult> = {
    claim_integrity: claimIntegrity,
    source_integrity: sourceIntegrity,
    voice_match: voiceMatch,
    originality,
    platform_fit: platformFit,
    clarity,
    hook_honesty: hookHonesty,
    privacy,
    personal_experience: personalExperience,
    editability,
    approval_state: approvalState,
    publishing,
  };

  const overallStatus = worstStatus(Object.values(dimensions));
  const requiredUserActions = Object.entries(dimensions).flatMap(([name, result]) => requiredActionsFrom(name, result));

  return {
    overallStatus,
    claimIntegrity,
    sourceIntegrity,
    voiceMatch,
    originality,
    platformFit,
    clarity,
    hookHonesty,
    privacy,
    personalExperience,
    editability,
    approvalState,
    publishing,
    riskFlags: topicRiskFlags,
    requiredUserActions,
    publishAllowed: false,
  };
}

// A stand-in QaResult for when runQaGate itself throws (e.g. every configured LLM
// provider was down/rate-limited — a real, observed failure mode, not hypothetical:
// see the 2026-09-15 incident). Callers use this so a draft/edit still reaches
// in_review instead of getting permanently stranded before submitForReview ever
// runs — content_items has no "QA errored" state to fall back to otherwise, and a
// human still needs a normal review queue entry to act on. Deliberately BLOCKED
// (never PASS/PASS_WITH_WARNINGS) so it can never be mistaken for a real QA
// verdict and never permits a publish — every dimension's notes say plainly that
// QA did not run, not that content issues were found.
export function buildQaGateUnavailableResult(errorMessage: string): QaResult {
  const notes = `QA gate could not run: ${errorMessage}. Not a content judgment — review manually before approving.`;
  const unavailable: QaDimensionResult = { status: 'FAIL', notes };
  return {
    overallStatus: 'BLOCKED',
    claimIntegrity: unavailable,
    sourceIntegrity: unavailable,
    voiceMatch: unavailable,
    originality: unavailable,
    platformFit: unavailable,
    clarity: unavailable,
    hookHonesty: unavailable,
    privacy: unavailable,
    personalExperience: unavailable,
    editability: unavailable,
    approvalState: unavailable,
    publishing: unavailable,
    riskFlags: [],
    requiredUserActions: ['QA gate did not run — review this version manually before approving.'],
    publishAllowed: false,
  };
}
