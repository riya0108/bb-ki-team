import type { LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import { runQaGate } from '@bb/qa-gate';
import type { InstagramFormat, InstagramPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';

import { buildInstagramCarouselPackage, buildInstagramPostPackage, buildInstagramReelPackage } from './packaging.js';
import { routeInstagramFormat } from './routing.js';
import { draftInstagramCarousel } from './specialists/carousels.js';
import { draftInstagramPost } from './specialists/posts.js';
import { draftInstagramReel } from './specialists/reels.js';

const CREATED_BY_AGENT = 'agent-03-instagram';

// Platform label fed to qa-gate's rubric checks (RubricCheckInput.platform) — each
// format has genuinely different "native" conventions, so QA judges them separately
// rather than under one generic "Instagram" label.
const QA_PLATFORM_LABEL: Record<InstagramFormat, string> = {
  post: 'Instagram single post (image + caption)',
  carousel: 'Instagram carousel (swipeable slides)',
  reel: 'Instagram Reel script',
};

export interface RunInstagramHeadInput {
  pool: Pool;
  llm: LlmClient;
  topic: string;
  angle: string;
  coreClaim?: string | null;
  sourceTexts?: string[];
  sourceReferences?: string[];
  // Spec 7.1: "The user may override the routing decision by explicitly naming the
  // format." Omit to let the head agent score the idea itself.
  format?: InstagramFormat;
  runId: string;
}

// Spec 7.2's Instagram Head workflow: load DNA, decide/accept the format, hire the
// matching specialist (03A/03B/03C), run the QA gate, persist, and submit for review.
// Never publishes or schedules — Phase 2 has no publish connector.
export async function runInstagramHead(input: RunInstagramHeadInput): Promise<InstagramPackage> {
  const dna = await loadCurrentDna(input.pool);
  const sourceTexts = input.sourceTexts ?? [];
  const sourceReferences = input.sourceReferences ?? [];
  const coreClaim = input.coreClaim ?? null;

  const format = input.format ?? (await routeInstagramFormat(input.topic, input.angle, dna, input.llm, input.runId));

  const draftDeps = {
    topic: input.topic,
    angle: input.angle,
    coreClaim,
    sourceTexts,
    contentDna: dna,
    llm: input.llm,
    runId: input.runId,
    stepId: `draft-instagram-${format}`,
  };

  if (format === 'post') {
    const draft = await draftInstagramPost(draftDeps);
    const item = await createContentItem(input.pool, {
      platform: 'instagram',
      createdByAgent: CREATED_BY_AGENT,
      mode: 'single_topic',
      topic: input.topic,
      angle: input.angle,
      coreClaim,
      sourceUrls: sourceReferences,
      contentDnaVersion: dna.version,
      text: draft.caption,
      riskLevel: 'low',
      package: { format: 'post', ...draft },
    });
    const qa = await runQaGate({
      finalPost: draft.caption,
      sourceReferences,
      sourceTexts,
      contentDna: dna,
      status: item.status,
      llm: input.llm,
      runId: input.runId,
      stepId: `qa-${item.id}`,
      platform: QA_PLATFORM_LABEL.post,
    });
    await recordQaResult(input.pool, item.id, item.currentVersion, qa);
    const reviewedItem = await submitForReview(input.pool, item.id);
    return buildInstagramPostPackage(reviewedItem, draft);
  }

  if (format === 'carousel') {
    const draft = await draftInstagramCarousel(draftDeps);
    const item = await createContentItem(input.pool, {
      platform: 'instagram',
      createdByAgent: CREATED_BY_AGENT,
      mode: 'single_topic',
      topic: input.topic,
      angle: input.angle,
      coreClaim,
      sourceUrls: sourceReferences,
      contentDnaVersion: dna.version,
      text: draft.caption,
      riskLevel: 'low',
      package: { format: 'carousel', ...draft, slideCount: draft.slides.length },
    });
    const qa = await runQaGate({
      finalPost: `${draft.coverHook}\n\n${draft.slides.map((s) => `${s.headline}\n${s.body}`).join('\n\n')}\n\n${draft.caption}`,
      sourceReferences,
      sourceTexts,
      contentDna: dna,
      status: item.status,
      llm: input.llm,
      runId: input.runId,
      stepId: `qa-${item.id}`,
      platform: QA_PLATFORM_LABEL.carousel,
    });
    await recordQaResult(input.pool, item.id, item.currentVersion, qa);
    const reviewedItem = await submitForReview(input.pool, item.id);
    return buildInstagramCarouselPackage(reviewedItem, draft);
  }

  const draft = await draftInstagramReel(draftDeps);
  const item = await createContentItem(input.pool, {
    platform: 'instagram',
    createdByAgent: CREATED_BY_AGENT,
    mode: 'single_topic',
    topic: input.topic,
    angle: input.angle,
    coreClaim,
    sourceUrls: sourceReferences,
    contentDnaVersion: dna.version,
    text: draft.spokenScript,
    riskLevel: 'low',
    package: { format: 'reel', ...draft },
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
    platform: QA_PLATFORM_LABEL.reel,
  });
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);
  const reviewedItem = await submitForReview(input.pool, item.id);
  return buildInstagramReelPackage(reviewedItem, draft);
}
