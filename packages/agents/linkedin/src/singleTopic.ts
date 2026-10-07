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
import type { ContentDnaRecord, LinkedinPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';
import { z } from 'zod';

import { draftLinkedinPost } from './draftPost.js';
import { buildLinkedinPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-01-linkedin';
const MAX_ANGLES = 3;

const AngleOptionSchema = z.object({ angle: z.string(), description: z.string() });
export type AngleOption = z.infer<typeof AngleOptionSchema>;

const ProposeAnglesResponseSchema = z.object({ angles: z.array(AngleOptionSchema).min(1).max(MAX_ANGLES) });

function buildProposeAnglesSystemPrompt(dna: ContentDnaRecord): string {
  return `You are Agent 01 — the Bull or Bear LinkedIn Head Agent, in Single Topic mode (spec 5.1).
Given a topic the creator wants to post about, propose 1-3 genuinely different angles (not
paraphrases of one idea — spec 5.8). Each angle should be a distinct way into the topic: a
different insight, disagreement, mechanism, or audience implication.

Creator's Content DNA:
- Role: ${dna.identity.role}
- Expertise: ${dna.identity.expertise.join(', ') || 'unspecified'}
- Strongly held opinions: ${dna.opinions.stronglyHeld.join(', ') || 'none noted'}
- Topics to avoid: ${dna.topics.avoid.join(', ') || 'none noted'}`;
}

export async function proposeLinkedinAngles(
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
          content: `Topic: ${topic}\n\nPropose 1-3 distinct angles as JSON: { "angles": [{ "angle": ..., "description": ... }] }.`,
        },
      ],
      runId,
      stepId: 'propose-angles',
    },
    ProposeAnglesResponseSchema,
  );
  return response.angles;
}

export interface DraftSingleTopicPostInput {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  logger: Logger;
  topic: string;
  // null lets the editorial pipeline choose the strongest verified angle.
  angle: string | null;
  // The user's original chat message, when there is one (spec 34/35).
  userMessage?: string | null;
  runId: string;
}

// Drafts, persists, QA-gates and submits for review the post for one already-chosen
// angle (spec 5.1's "1-3 angles, then final editable post" — angle selection is the
// caller's/human's job; this covers the second half of that flow).
export async function draftSingleTopicPost(input: DraftSingleTopicPostInput): Promise<LinkedinPackage> {
  const dna = await loadCurrentDna(input.pool);

  // Topic -> research -> verified EditorialBrief before drafting (spec 33). Reuses the
  // brief X/Blog already built for the same story, so all platforms share one core.
  const brief = await prepareEditorialBrief(
    { pool: input.pool, llm: input.llm, fetchTool: input.fetchTool, logger: input.logger },
    { topic: input.topic, userMessage: input.userMessage ?? null, angle: input.angle, contentDna: dna, runId: input.runId },
  );
  const angle = input.angle ?? brief.selectedAngle?.angle ?? input.topic;

  const { draft } = await draftWithMeaningGuard({
    brief,
    draft: (revisionNotes) =>
      draftLinkedinPost({
        topic: input.topic,
        angle,
        coreClaim: null,
        sourceTexts: [],
        contentDna: dna,
        llm: input.llm,
        runId: input.runId,
        stepId: 'draft-single-topic',
        editorialBrief: brief,
        revisionNotes,
      }),
    textOf: (d) => d.finalPost,
    logger: input.logger,
    runId: input.runId,
    stepId: 'draft-single-topic',
  });
  const sourceReferences = briefSourceReferences(brief);

  const item = await createContentItem(input.pool, {
    platform: 'linkedin',
    createdByAgent: CREATED_BY_AGENT,
    mode: 'single_topic',
    topic: input.topic,
    angle,
    sourceUrls: sourceReferences,
    contentDnaVersion: dna.version,
    text: draft.finalPost,
    riskLevel: brief.riskLevel,
    package: { supportingClaimIds: draft.supportingClaimIds, editorialBrief: brief },
  });

  const qa = await runQaGate({
    finalPost: draft.finalPost,
    sourceReferences,
    sourceTexts: briefSourceTexts(brief),
    contentDna: dna,
    status: item.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${item.id}`,
    platform: 'LinkedIn',
    editorial: { brief, siblingDrafts: await loadSiblingDrafts(input.pool, brief.id, item.id) },
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);

  return buildLinkedinPackage(reviewedItem, draft, qa, buildEditorialSummary(brief));
}
