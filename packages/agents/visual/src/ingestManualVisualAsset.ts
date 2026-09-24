import type { LlmClient } from '@bb/core';
import { getLatestVisualAssetForContent } from '@bb/db';
import type { Queryable } from '@bb/db';
import type { ImageGenTool } from '@bb/mcp-client';
import type { VisualAsset } from '@bb/shared-types';

import { finalizeVisualAsset } from './finalizeVisualAsset.js';

export class VisualBriefNotPendingError extends Error {
  constructor(contentId: string, visualId: string) {
    super(
      `No GENERATION_PENDING visual brief ${visualId} found for content ${contentId}. Call ` +
        'prepareVisualBrief first — ingestManualVisualAsset only finalizes a brief that already exists.',
    );
    this.name = 'VisualBriefNotPendingError';
  }
}

export interface IngestManualVisualAssetInput {
  contentId: string;
  visualId: string;
  pool: Queryable;
  llm: LlmClient;
  runId: string;
  // Reuses ImageGenTool only for storeVisualAsset (Supabase) — generateImage is
  // never called here, since the bytes already exist (a human/Claude generated
  // them in a browser session; see .agents/skills/bb-visual-agent).
  imageGen: ImageGenTool;
  base64Data: string;
  mimeType: string;
  // e.g. 'chatgpt-web' / 'gemini-web' — recorded honestly as the actual source,
  // never mislabeled as our own configured provider (CLAUDE.md: never fabricate).
  provider: string;
  model: string;
}

// Finishes a visual stage started by prepareVisualBrief, for an image that was
// generated manually (a human or Claude driving a browser session against
// ChatGPT/Gemini/etc, rather than this repo's own image-gen MCP server) and then
// downloaded to a file. Runs the exact same visual QA and storage path as the
// automated runVisualStage.ts — a manually-sourced image gets no less scrutiny.
export async function ingestManualVisualAsset(
  input: IngestManualVisualAssetInput,
): Promise<VisualAsset> {
  const existing = await getLatestVisualAssetForContent(input.pool, input.contentId);
  if (existing?.id !== input.visualId || existing.status !== 'GENERATION_PENDING') {
    throw new VisualBriefNotPendingError(input.contentId, input.visualId);
  }

  const {
    status: _status,
    qa: _qa,
    masterAsset: _masterAsset,
    blockingReasons: _blockingReasons,
    ...baseAsset
  } = existing;

  return finalizeVisualAsset({
    pool: input.pool,
    llm: input.llm,
    contentId: input.contentId,
    runId: input.runId,
    baseAsset,
    image: {
      provider: input.provider,
      model: input.model,
      generationId: `manual:${input.visualId}:${Date.now()}`,
      base64Data: input.base64Data,
      mimeType: input.mimeType,
    },
    storeAsset: (request) => input.imageGen.storeVisualAsset(request),
  });
}
