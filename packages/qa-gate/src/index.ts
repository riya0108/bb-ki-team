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
  const { finalPost, sourceReferences, sourceTexts, contentDna, status, llm, runId, stepId } = input;

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

  const rubricInput = { finalPost, sourceTexts, dna: contentDna, llm, runId, stepId };
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
