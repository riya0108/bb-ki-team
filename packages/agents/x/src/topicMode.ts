import type { LlmClient, Logger } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import {
  briefSourceReferences,
  briefSourceTexts,
  buildEditorialSummary,
  draftWithMeaningGuard,
  loadSiblingDrafts,
  prepareEditorialBrief,
} from '@bb/editorial-intelligence';
import type { FetchTool } from '@bb/mcp-client';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { ContentDnaRecord, XPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';
import { z } from 'zod';

import { draftXPost } from './draftPost.js';
import { appendHashtags, buildXPackage, enforceXLengthLimit } from './packaging.js';

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
  // Research runs through the agent's scoped fetch MCP tool (spec 33: factual topics are
  // researched automatically, without the user asking).
  fetchTool: FetchTool;
  logger: Logger;
  topic: string;
  // null lets the editorial pipeline choose the strongest verified angle.
  angle: string | null;
  // The user's original chat message, when there is one — carries facts and hook
  // suggestions the intent classifier's short topic string drops (spec 34/35).
  userMessage?: string | null;
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

  // Topic -> research -> verified EditorialBrief, before any drafting (spec 33).
  const brief = await prepareEditorialBrief(
    { pool: input.pool, llm: input.llm, fetchTool: input.fetchTool, logger: input.logger },
    { topic: input.topic, userMessage: input.userMessage ?? null, angle: input.angle, contentDna: dna, runId: input.runId },
  );
  const angle = input.angle ?? brief.selectedAngle?.angle ?? input.topic;

  const { draft: rawDraft } = await draftWithMeaningGuard({
    brief,
    draft: (revisionNotes) =>
      draftXPost({
        topic: input.topic,
        angle,
        coreClaim: null,
        sourceTexts: [],
        contentDna: dna,
        llm: input.llm,
        runId: input.runId,
        stepId: `draft-x-${input.mode}`,
        forceMode,
        editorialBrief: brief,
        revisionNotes,
      }),
    textOf: (d) => [d.finalCopy, ...(d.threadPosts ?? [])].join('\n'),
    logger: input.logger,
    runId: input.runId,
    stepId: `draft-x-${input.mode}`,
  });
  const draft = appendHashtags(enforceXLengthLimit(rawDraft));
  const sourceReferences = briefSourceReferences(brief);
  const fullText = draft.threadPosts ? draft.threadPosts.join('\n\n') : draft.finalCopy;

  const item = await createContentItem(input.pool, {
    platform: 'x',
    createdByAgent: CREATED_BY_AGENT,
    mode: input.mode,
    topic: input.topic,
    angle,
    sourceUrls: sourceReferences,
    contentDnaVersion: dna.version,
    text: draft.finalCopy,
    riskLevel: brief.riskLevel,
    package: {
      mode: draft.mode,
      hookOptions: draft.hookOptions,
      threadPosts: draft.threadPosts,
      hashtags: draft.hashtags,
      supportingClaimIds: draft.supportingClaimIds,
      editorialBrief: brief,
    },
  });

  const qa = await runQaGate({
    finalPost: fullText,
    sourceReferences,
    sourceTexts: briefSourceTexts(brief),
    contentDna: dna,
    status: item.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${item.id}`,
    platform: 'X',
    editorial: { brief, siblingDrafts: await loadSiblingDrafts(input.pool, brief.id, item.id), opening: draft.finalCopy },
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);

  return buildXPackage(reviewedItem, draft, draft.mode, buildEditorialSummary(brief));
}
