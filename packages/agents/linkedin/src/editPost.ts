import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import { classifyEditInstruction, classifyLearningSignal, loadCurrentDna, recordLearningEvent } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import {
  briefSourceTexts,
  buildEditorialSummary,
  editorialBriefFromPackage,
  loadSiblingDrafts,
  renderProtectedFactsForEditor,
} from '@bb/editorial-intelligence';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { ContentDnaRecord, EditorialBrief, LearningEvent, LinkedinPackage } from '@bb/shared-types';
import { ContentItemNotFoundError, addRevision, getContentItem, recordQaResult } from '@bb/workflows';

import { DraftLinkedinPostOutputSchema, LINKEDIN_HARD_RULES, LINKEDIN_POST_STRUCTURE } from './draftPost.js';
import { buildLinkedinPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-01-linkedin';

function buildReviseSystemPrompt(dna: ContentDnaRecord, brief: EditorialBrief | null): string {
  return `You are Agent 01 — the Bull or Bear LinkedIn Thought Leadership Head Agent, in Edit mode
(spec 5.1: "Make this sound more like me" -> revised full post).

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Preferred phrases: ${dna.voice.preferredPhrases.join(', ') || 'none noted'}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}
- Hook patterns the creator tends to use: ${dna.storytelling.hookPatterns.join(', ') || 'none noted'}

Required post structure (spec 5.6):
${LINKEDIN_POST_STRUCTURE}

Hard rules (spec 5.8):
${LINKEDIN_HARD_RULES}

Revise the post per the instruction below. Do not change the underlying topic, claims or facts —
only revise wording, structure, tone and hooks. Preserve anything the instruction doesn't ask you to
change.${renderProtectedFactsForEditor(brief)}`;
}

function buildReviseUserPrompt(originalPost: string, instruction: string): string {
  return `Original post:\n${originalPost}\n\nEdit instruction: ${instruction}\n\nReturn the revised post
using the required JSON shape (hookOptions, finalPost, visualSuggestion, firstCommentOptional,
factCheckStatus, originalityStatus).`;
}

export interface ReviseLinkedinPostInput {
  pool: Pool;
  llm: LlmClient;
  contentId: string;
  instruction: string;
  runId: string;
}

export interface ReviseLinkedinPostResult {
  package: LinkedinPackage;
  // Non-null only when the edit instruction reads as a general voice/style preference
  // rather than a one-off content tweak (spec 16: the Learning Loop). Recording this
  // never changes Content DNA by itself — a human must call confirmDnaChange
  // separately (spec 3.4: never silently change the creator's identity).
  learningEvent: LearningEvent | null;
}

// Spec 5.1 Edit mode. Every edit is its own revision (packages/workflows's addRevision
// handles the version bump and, per spec 15.2, invalidates/resubmits an approved item
// for review) and gets a fresh QA pass — an edited post can never coast on the QA
// result computed for a previous version.
export async function reviseLinkedinPost(input: ReviseLinkedinPostInput): Promise<ReviseLinkedinPostResult> {
  const item = await getContentItem(input.pool, input.contentId);
  if (!item) throw new ContentItemNotFoundError(input.contentId);

  const dna = await loadCurrentDna(input.pool);
  // addRevision below leaves content_items.package untouched, so the brief this post
  // was drafted from stays attached and every edit is QA'd against the same claims.
  const brief = editorialBriefFromPackage(item.package);

  const revised = await input.llm.completeStructured(
    {
      system: buildReviseSystemPrompt(dna, brief),
      messages: [{ role: 'user', content: buildReviseUserPrompt(item.currentText, input.instruction) }],
      runId: input.runId,
      stepId: `revise-${item.id}`,
    },
    DraftLinkedinPostOutputSchema,
  );

  const { item: revisedItem } = await addRevision(input.pool, input.contentId, {
    changeType: 'ai_regeneration',
    newText: revised.finalPost,
    changedBy: 'agent',
    changedById: CREATED_BY_AGENT,
    reason: input.instruction,
  });

  // The original fetched source text isn't persisted, only its URLs — but a post drafted
  // through the editorial pipeline carries its brief's verified claim ledger, so edits
  // are re-checked against the same claims. Posts without a brief (repurpose/PostCast)
  // still get the weaker, URL-only re-verification: a real limitation, not papered over.
  const qa = await runQaGate({
    finalPost: revised.finalPost,
    sourceReferences: revisedItem.sourceUrls,
    sourceTexts: brief ? briefSourceTexts(brief) : [],
    contentDna: dna,
    status: revisedItem.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${revisedItem.id}-v${revisedItem.currentVersion}`,
    platform: 'LinkedIn',
    ...(brief ? { editorial: { brief, siblingDrafts: await loadSiblingDrafts(input.pool, brief.id, revisedItem.id) } } : {}),
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, revisedItem.id, revisedItem.currentVersion, qa);

  // Best-effort: a failure here only costs the Learning Loop's voice-signal
  // detection for this one edit, never the edit itself (already persisted above).
  const classification = await classifyEditInstruction(input.instruction, dna, input.llm, input.runId).catch(
    () => ({ isVoiceLevelInstruction: false as const, summary: '', proposedChange: null }),
  );
  let learningEvent: LearningEvent | null = null;
  if (classification.isVoiceLevelInstruction) {
    learningEvent = await recordLearningEvent(input.pool, {
      contentId: revisedItem.id,
      source: 'user_instruction',
      observation: classification.summary,
      strength: classifyLearningSignal({ kind: 'explicit_instruction', text: input.instruction }),
      proposedChange: classification.proposedChange,
    });
  }

  return {
    package: buildLinkedinPackage(revisedItem, revised, qa, brief ? buildEditorialSummary(brief) : null),
    learningEvent,
  };
}
