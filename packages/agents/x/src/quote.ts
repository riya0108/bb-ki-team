import type { LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import { FetchToolError } from '@bb/mcp-client';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { XPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';

import { draftXPost } from './draftPost.js';
import { RepurposeSourceInaccessibleError } from './errors.js';
import { buildXPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-02-x';

export type QuoteSource = { kind: 'url'; url: string } | { kind: 'text'; label: string; text: string };

export interface RunQuoteInput {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  source: QuoteSource;
  // What the creator's commentary/reaction should actually say — required, since a
  // quote post without a point of view is just a repost (spec 6.1's "commentary").
  commentaryAngle: string;
  runId: string;
}

async function resolveSourceText(source: QuoteSource, fetchTool: FetchTool): Promise<{ text: string; reference: string }> {
  if (source.kind === 'text') return { text: source.text, reference: source.label };
  try {
    const result = await fetchTool.fetchUrl(source.url);
    return { text: result.text, reference: source.url };
  } catch (error) {
    if (error instanceof FetchToolError) throw new RepurposeSourceInaccessibleError(source.url, error.message);
    throw error;
  }
}

// Spec 6.1 Quote/commentary mode: react to a supplied post or article with the
// creator's own point of view. Always single-shaped under the hood (see packaging.ts)
// — a quote post is a reaction, not a multi-part explainer.
export async function runQuote(input: RunQuoteInput): Promise<XPackage> {
  const dna = await loadCurrentDna(input.pool);
  const { text: sourceText, reference } = await resolveSourceText(input.source, input.fetchTool);

  const draft = await draftXPost({
    topic: `Commentary on: ${reference}`,
    angle: input.commentaryAngle,
    coreClaim: null,
    sourceTexts: [sourceText],
    contentDna: dna,
    llm: input.llm,
    runId: input.runId,
    stepId: 'draft-quote',
    forceMode: 'single',
  });

  const item = await createContentItem(input.pool, {
    platform: 'x',
    createdByAgent: CREATED_BY_AGENT,
    mode: 'quote',
    topic: `Commentary on: ${reference}`,
    angle: input.commentaryAngle,
    sourceUrls: [reference],
    contentDnaVersion: dna.version,
    text: draft.finalCopy,
    riskLevel: 'low',
    package: { mode: 'quote', hookOptions: draft.hookOptions, threadPosts: null },
  });

  const qa = await runQaGate({
    finalPost: draft.finalCopy,
    sourceReferences: [reference],
    sourceTexts: [sourceText],
    contentDna: dna,
    status: item.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${item.id}`,
    platform: 'X',
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);
  return buildXPackage(reviewedItem, draft, 'quote');
}
