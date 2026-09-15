import type { Logger, LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import { FetchToolError } from '@bb/mcp-client';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { AgentMode, ContentDnaRecord, LinkedinPackage } from '@bb/shared-types';
import { RiskLevelSchema } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';
import { z } from 'zod';

import { draftLinkedinPost } from './draftPost.js';
import { RepurposeSourceInaccessibleError } from './errors.js';
import { buildLinkedinPackage } from './packaging.js';
import { selectDistinctTopics } from './sourceDiscovery.js';
import type { CandidateTopic } from './sourceDiscovery.js';

const CREATED_BY_AGENT = 'agent-01-linkedin';
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
  return `You are the research-lead half of Agent 01 — the Bull or Bear LinkedIn Head Agent, in
Repurpose mode (spec 5.1: "turn this article/PDF/video into LinkedIn posts" -> original posts based
on the source). The creator handed you one specific source and wants ${requestedCount} original
LinkedIn post(s) drawn from it. You are a research lead, not a ghostwriter (spec 5.5): extract topics
and angles from the source, never sentences to copy.

Creator's Content DNA:
- Primary topics: ${dna.topics.primary.join(', ') || 'none noted'}
- Expertise: ${dna.identity.expertise.join(', ') || 'unspecified'}
- Topics to avoid: ${dna.topics.avoid.join(', ') || 'none noted'}

Rules:
- Only propose an angle actually supported by the supplied source text — never invent one.
- If asked for more than one post, give each candidate a genuinely distinct angle (spec 5.8: never
  produce two drafts that are essentially the same); propose a few extra candidates beyond the
  requested count so a selection with distinct angles is possible.
- coreClaim is the one specific, checkable claim the post would center on, or null if the angle
  doesn't hinge on a specific claim.
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
  // Reuses sourceDiscovery.ts's CandidateTopic shape by stamping the one supplied
  // sourceUrl onto every candidate — selectDistinctTopics only cares about
  // topic/relevanceScore for dedup and doesn't touch sourceUrl otherwise.
  return response.candidates.map((candidate) => ({ ...candidate, sourceUrl: '' }));
}

// A fetchable URL (article/PDF — spec 5.1 Repurpose row) or raw text the creator
// already has in hand (a pasted transcript or voice-note transcription — spec 5.1's
// "transcript/voice note" rows). Both need only text to draft from; audio-to-text and
// video-to-transcript are separate, not-yet-built capabilities (see CLAUDE.md: no
// stubbed external services) — this function starts from text either way.
export type RepurposeSource = { kind: 'url'; url: string } | { kind: 'text'; label: string; text: string };

export interface RunRepurposeInput {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  source: RepurposeSource;
  // Spec 5.1 gives 'repurpose' (article/PDF), 'voice_note' and 'youtube_link' distinct
  // AgentMode values even though they share this same "draft from text" mechanism —
  // callers must say which request this actually is so content items are labeled
  // correctly, rather than this function silently defaulting one over another.
  mode: Extract<AgentMode, 'repurpose' | 'voice_note' | 'youtube_link'>;
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

// Spec 5.1 Repurpose / Voice Note rows, and the text half of the YouTube-Link row
// (pass its transcript in as source: { kind: 'text', ... } once one is obtained —
// video-to-transcript itself needs a not-yet-built connector). Unlike source
// discovery, the source is user-supplied, not drawn from the trusted registry, so it
// is never written to the sources table.
export async function runRepurpose(input: RunRepurposeInput): Promise<LinkedinPackage[]> {
  const { pool, llm, fetchTool, source, mode, runId } = input;
  const postCount = Math.min(input.postCount ?? DEFAULT_POST_COUNT, MAX_POST_COUNT);

  const dna = await loadCurrentDna(pool);
  const { text: sourceText, reference } = await resolveSourceText(source, fetchTool);

  const candidates = await extractRepurposeCandidates(sourceText, postCount, dna, llm, runId);
  const selected = selectDistinctTopics(candidates, postCount);

  const packages: LinkedinPackage[] = [];
  for (const candidate of selected) {
    const draft = await draftLinkedinPost({
      topic: candidate.topic,
      angle: candidate.angle,
      coreClaim: candidate.coreClaim,
      sourceTexts: [sourceText],
      contentDna: dna,
      llm,
      runId,
      stepId: `draft-repurpose-${candidate.topic}`,
    });

    const item = await createContentItem(pool, {
      platform: 'linkedin',
      createdByAgent: CREATED_BY_AGENT,
      mode,
      topic: candidate.topic,
      coreClaim: candidate.coreClaim,
      angle: candidate.angle,
      sourceUrls: [reference],
      contentDnaVersion: dna.version,
      text: draft.finalPost,
      riskLevel: candidate.riskLevel,
    });

    const qa = await runQaGate({
      finalPost: draft.finalPost,
      sourceReferences: [reference],
      sourceTexts: [sourceText],
      contentDna: dna,
      status: item.status,
      llm,
      runId,
      stepId: `qa-${item.id}`,
      platform: 'LinkedIn',
    }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
    await recordQaResult(pool, item.id, item.currentVersion, qa);

    const reviewedItem = await submitForReview(pool, item.id);
    packages.push(buildLinkedinPackage(reviewedItem, draft, qa));
  }

  return packages;
}
