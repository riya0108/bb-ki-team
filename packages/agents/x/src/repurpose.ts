import type { Logger, LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import { FetchToolError } from '@bb/mcp-client';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { ContentDnaRecord, XPackage } from '@bb/shared-types';
import { RiskLevelSchema } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';
import { z } from 'zod';

import { draftXPost } from './draftPost.js';
import { RepurposeSourceInaccessibleError } from './errors.js';
import { buildXPackage, enforceXLengthLimit } from './packaging.js';
import { selectDistinctTopics } from './sourceDiscovery.js';
import type { CandidateTopic } from './sourceDiscovery.js';

const CREATED_BY_AGENT = 'agent-02-x';
const DEFAULT_POST_COUNT = 1;
const MAX_POST_COUNT = 3;

const CandidateAngleSchema = z.object({
  topic: z.string(),
  coreClaim: z.string().nullable(),
  angle: z.string(),
  relevanceScore: z.number().min(0).max(1),
  riskLevel: RiskLevelSchema,
});
const CandidateAnglesResponseSchema = z.object({ candidates: z.array(CandidateAngleSchema) });

function buildCandidateExtractionSystemPrompt(dna: ContentDnaRecord, requestedCount: number): string {
  return `You are the research-lead half of Agent 02 — the Bull or Bear X Content Head Agent, in
Repurpose mode (spec 6.1: repurpose from YouTube, blog, LinkedIn, PDF or voice note). The creator
handed you one specific source and wants ${requestedCount} original X post(s)/thread(s) drawn from
it. You are a research lead, not a ghostwriter (spec 5.5): extract topics and angles, never
sentences to copy.

Creator's Content DNA:
- Primary topics: ${dna.topics.primary.join(', ') || 'none noted'}
- Expertise: ${dna.identity.expertise.join(', ') || 'unspecified'}
- Topics to avoid: ${dna.topics.avoid.join(', ') || 'none noted'}

Rules:
- Only propose an angle actually supported by the supplied source text — never invent one.
- If asked for more than one post, give each candidate a genuinely distinct angle; propose a few
  extra candidates beyond the requested count so a selection with distinct angles is possible.
- coreClaim is the one specific, checkable claim the post would center on, or null if it doesn't
  hinge on one.
- riskLevel should be "high" for anything touching legal, medical, safety-critical or unverified
  financial-outcome claims; otherwise "low" or "medium".`;
}

async function extractRepurposeCandidates(
  sourceText: string,
  requestedCount: number,
  dna: ContentDnaRecord,
  llm: LlmClient,
  runId: string,
): Promise<CandidateTopic[]> {
  const response = await llm.completeStructured(
    {
      system: buildCandidateExtractionSystemPrompt(dna, requestedCount),
      messages: [{ role: 'user', content: sourceText.slice(0, 6000) }],
      runId,
      stepId: 'repurpose-extract-candidates',
    },
    CandidateAnglesResponseSchema,
  );
  return response.candidates.map((candidate) => ({ ...candidate, sourceUrl: '' }));
}

// A fetchable URL or raw text the creator already has (pasted transcript/voice-note
// transcription) — same shape as packages/agents/linkedin's RepurposeSource.
export type RepurposeSource = { kind: 'url'; url: string } | { kind: 'text'; label: string; text: string };

export interface RunRepurposeInput {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  source: RepurposeSource;
  logger: Logger;
  runId: string;
  postCount?: number;
}

async function resolveSourceText(
  source: RepurposeSource,
  fetchTool: FetchTool,
): Promise<{ text: string; reference: string }> {
  if (source.kind === 'text') {
    return { text: source.text, reference: source.label };
  }
  try {
    const result = await fetchTool.fetchUrl(source.url);
    return { text: result.text, reference: source.url };
  } catch (error) {
    if (error instanceof FetchToolError) {
      throw new RepurposeSourceInaccessibleError(source.url, error.message);
    }
    throw error;
  }
}

// Spec 6.1 Repurpose mode: from YouTube, blog, LinkedIn, PDF or voice note — all
// reduced to "some text", same as packages/agents/linkedin's repurpose.ts.
export async function runRepurpose(input: RunRepurposeInput): Promise<XPackage[]> {
  const { pool, llm, fetchTool, source, runId } = input;
  const postCount = Math.min(input.postCount ?? DEFAULT_POST_COUNT, MAX_POST_COUNT);

  const dna = await loadCurrentDna(pool);
  const { text: sourceText, reference } = await resolveSourceText(source, fetchTool);

  const candidates = await extractRepurposeCandidates(sourceText, postCount, dna, llm, runId);
  const selected = selectDistinctTopics(candidates, postCount);

  const packages: XPackage[] = [];
  for (const candidate of selected) {
    const draft = enforceXLengthLimit(
      await draftXPost({
        topic: candidate.topic,
        angle: candidate.angle,
        coreClaim: candidate.coreClaim,
        sourceTexts: [sourceText],
        contentDna: dna,
        llm,
        runId,
        stepId: `draft-repurpose-${candidate.topic}`,
      }),
    );

    const item = await createContentItem(pool, {
      platform: 'x',
      createdByAgent: CREATED_BY_AGENT,
      mode: 'repurpose',
      topic: candidate.topic,
      coreClaim: candidate.coreClaim,
      angle: candidate.angle,
      sourceUrls: [reference],
      contentDnaVersion: dna.version,
      text: draft.finalCopy,
      riskLevel: candidate.riskLevel,
      package: { mode: draft.mode, hookOptions: draft.hookOptions, threadPosts: draft.threadPosts },
    });

    const qa = await runQaGate({
      finalPost: draft.finalCopy,
      sourceReferences: [reference],
      sourceTexts: [sourceText],
      contentDna: dna,
      status: item.status,
      llm,
      runId,
      stepId: `qa-${item.id}`,
      platform: 'X',
    }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
    await recordQaResult(pool, item.id, item.currentVersion, qa);

    const reviewedItem = await submitForReview(pool, item.id);
    packages.push(buildXPackage(reviewedItem, draft));
  }

  return packages;
}
