import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import { classifyEditInstruction, classifyLearningSignal, loadCurrentDna, recordLearningEvent } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import { runQaGate } from '@bb/qa-gate';
import type { ContentDnaRecord, LearningEvent, XPackage } from '@bb/shared-types';
import { ContentItemNotFoundError, addRevision, getContentItem, recordQaResult } from '@bb/workflows';

import { DraftXOutputSchema, X_NATIVE_PRINCIPLES } from './draftPost.js';
import { buildXPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-02-x';

function buildReviseSystemPrompt(dna: ContentDnaRecord, wasThread: boolean): string {
  return `You are Agent 02 — the Bull or Bear X Content Head Agent, in Edit mode (spec 6.1:
rewrite/edit mode).

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}
X-native principles (spec 6.2):
${X_NATIVE_PRINCIPLES.map((p) => `- ${p}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

This post is currently a ${wasThread ? 'THREAD — keep it a thread unless the instruction says otherwise' : 'SINGLE post — keep it a single post unless the instruction says otherwise'}.

Revise per the instruction below. Do not change the underlying topic, claims or facts — only
revise wording, structure, tone and hooks. Preserve anything the instruction doesn't ask you to
change.`;
}

function buildReviseUserPrompt(originalPost: string, instruction: string): string {
  return `Original post:\n${originalPost}\n\nEdit instruction: ${instruction}\n\nReturn the revised
content using the required JSON shape (mode, hookOptions, finalCopy, threadPosts, factCheckStatus).`;
}

export interface ReviseXPostInput {
  pool: Pool;
  llm: LlmClient;
  contentId: string;
  instruction: string;
  runId: string;
}

export interface ReviseXPostResult {
  package: XPackage;
  learningEvent: LearningEvent | null;
}

// Spec 6.1 rewrite/edit mode. Every edit is its own revision (packages/workflows's
// addRevision) and gets a fresh QA pass, same invariants as LinkedIn's edit mode.
export async function reviseXPost(input: ReviseXPostInput): Promise<ReviseXPostResult> {
  const item = await getContentItem(input.pool, input.contentId);
  if (!item) throw new ContentItemNotFoundError(input.contentId);

  const dna = await loadCurrentDna(input.pool);
  const wasThread = (item.package as { mode?: string } | null)?.mode === 'thread';

  const revised = await input.llm.completeStructured(
    {
      system: buildReviseSystemPrompt(dna, wasThread),
      messages: [{ role: 'user', content: buildReviseUserPrompt(item.currentText, input.instruction) }],
      runId: input.runId,
      stepId: `revise-${item.id}`,
    },
    DraftXOutputSchema,
  );

  const { item: revisedItem } = await addRevision(input.pool, input.contentId, {
    changeType: 'ai_regeneration',
    newText: revised.finalCopy,
    changedBy: 'agent',
    changedById: CREATED_BY_AGENT,
    reason: input.instruction,
    package: { mode: revised.mode, hookOptions: revised.hookOptions, threadPosts: revised.threadPosts },
  });

  const qa = await runQaGate({
    finalPost: revised.finalCopy,
    sourceReferences: revisedItem.sourceUrls,
    sourceTexts: [],
    contentDna: dna,
    status: revisedItem.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${revisedItem.id}-v${revisedItem.currentVersion}`,
    platform: 'X',
  });
  await recordQaResult(input.pool, revisedItem.id, revisedItem.currentVersion, qa);

  const classification = await classifyEditInstruction(input.instruction, dna, input.llm, input.runId);
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

  return { package: buildXPackage(revisedItem, revised), learningEvent };
}
