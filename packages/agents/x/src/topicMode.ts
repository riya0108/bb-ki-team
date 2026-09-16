import type { LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { ContentDnaRecord, XPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';
import { z } from 'zod';

import { draftXPost } from './draftPost.js';
import { buildXPackage, enforceXLengthLimit } from './packaging.js';

const CREATED_BY_AGENT = 'agent-02-x';

const AngleOptionSchema = z.object({ angle: z.string(), description: z.string() });
export type AngleOption = z.infer<typeof AngleOptionSchema>;

const ProposeAnglesResponseSchema = z.object({ angles: z.array(AngleOptionSchema).min(1).max(3) });

function buildProposeAnglesSystemPrompt(dna: ContentDnaRecord): string {
  return `You are Agent 02 — the Bull or Bear X Content Head Agent (spec 6.3: "generate three
hook/angle options"). Given a topic, propose up to 3 genuinely different angles — not paraphrases
of one idea (spec 5.8, cross-platform). Each angle should be a distinct way into the topic.

Creator's Content DNA:
- Role: ${dna.identity.role}
- Strongly held opinions: ${dna.opinions.stronglyHeld.join(', ') || 'none noted'}
- Topics to avoid: ${dna.topics.avoid.join(', ') || 'none noted'}`;
}

export async function proposeXAngles(
  topic: string,
  dna: ContentDnaRecord,
  llm: LlmClient,
  runId: string,
): Promise<AngleOption[]> {
  const response = await llm.completeStructured(
    {
      system: buildProposeAnglesSystemPrompt(dna),
      messages: [
        {
          role: 'user',
          content: `Topic: ${topic}\n\nPropose up to 3 distinct angles as JSON: { "angles": [{ "angle": ..., "description": ... }] }.`,
        },
      ],
      runId,
      stepId: 'propose-angles',
    },
    ProposeAnglesResponseSchema,
  );
  return response.angles;
}

export interface DraftXTopicPostInput {
  pool: Pool;
  llm: LlmClient;
  topic: string;
  angle: string;
  // 'single_topic' -> spec 6.1's Single-post mode; 'thread' -> Thread mode. Drives
  // both the persisted AgentMode and whether draftXPost is forced into that shape.
  mode: 'single_topic' | 'thread';
  runId: string;
}

// Spec 6.1 Single-post mode and Thread mode share everything except whether the draft
// is forced into a single post or a thread — kept as one function so that shared
// behavior (persist, QA, submit for review) can't drift between the two.
export async function draftXTopicPost(input: DraftXTopicPostInput): Promise<XPackage> {
  const dna = await loadCurrentDna(input.pool);
  const forceMode = input.mode === 'thread' ? 'thread' : 'single';

  const draft = enforceXLengthLimit(
    await draftXPost({
      topic: input.topic,
      angle: input.angle,
      coreClaim: null,
      sourceTexts: [],
      contentDna: dna,
      llm: input.llm,
      runId: input.runId,
      stepId: `draft-x-${input.mode}`,
      forceMode,
    }),
  );

  const item = await createContentItem(input.pool, {
    platform: 'x',
    createdByAgent: CREATED_BY_AGENT,
    mode: input.mode,
    topic: input.topic,
    angle: input.angle,
    contentDnaVersion: dna.version,
    text: draft.finalCopy,
    riskLevel: 'low',
    package: { mode: draft.mode, hookOptions: draft.hookOptions, threadPosts: draft.threadPosts },
  });

  const qa = await runQaGate({
    finalPost: draft.finalCopy,
    sourceReferences: [],
    sourceTexts: [],
    contentDna: dna,
    status: item.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${item.id}`,
    platform: 'X',
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);

  return buildXPackage(reviewedItem, draft);
}
