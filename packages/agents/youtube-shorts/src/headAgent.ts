import type { LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { YoutubeShortPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';

import { draftYoutubeShort } from './draftShort.js';
import { buildYoutubeShortPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-04-youtube-shorts';
const QA_PLATFORM_LABEL = 'YouTube Shorts script';

export interface RunYoutubeShortInput {
  pool: Pool;
  llm: LlmClient;
  topic: string;
  angle: string;
  coreClaim?: string | null;
  sourceTexts?: string[];
  sourceReferences?: string[];
  runId: string;
}

// Spec 11.2's Shorts workflow, from an already-identified topic/angle (the "identify
// one self-contained idea" step already done by the caller — see repurpose.ts for
// the path that does that extraction itself from a longer source/video).
export async function runYoutubeShort(input: RunYoutubeShortInput): Promise<YoutubeShortPackage> {
  const dna = await loadCurrentDna(input.pool);
  const sourceTexts = input.sourceTexts ?? [];
  const sourceReferences = input.sourceReferences ?? [];
  const coreClaim = input.coreClaim ?? null;

  const draft = await draftYoutubeShort({
    topic: input.topic,
    angle: input.angle,
    coreClaim,
    sourceTexts,
    contentDna: dna,
    llm: input.llm,
    runId: input.runId,
    stepId: 'draft-youtube-short',
  });

  const item = await createContentItem(input.pool, {
    platform: 'youtube_shorts',
    createdByAgent: CREATED_BY_AGENT,
    mode: 'single_topic',
    topic: input.topic,
    angle: input.angle,
    coreClaim,
    sourceUrls: sourceReferences,
    contentDnaVersion: dna.version,
    text: draft.spokenScript,
    riskLevel: 'low',
    package: { ...draft },
  });

  const qa = await runQaGate({
    finalPost: draft.spokenScript,
    sourceReferences,
    sourceTexts,
    contentDna: dna,
    status: item.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${item.id}`,
    platform: QA_PLATFORM_LABEL,
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);
  return buildYoutubeShortPackage(reviewedItem, draft);
}
