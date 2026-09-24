import type { LlmClient } from '@bb/core';
import { upsertVisualAsset } from '@bb/db';
import type { Queryable } from '@bb/db';
import { ImageGenToolError } from '@bb/mcp-client';
import type { ImageGenTool } from '@bb/mcp-client';
import type { VisualAsset } from '@bb/shared-types';

import { finalizeVisualAsset } from './finalizeVisualAsset.js';
import { emptyMasterAsset, prepareVisualBrief } from './prepareVisualBrief.js';

export interface RunVisualStageInput {
  contentId: string;
  pool: Queryable;
  llm: LlmClient;
  imageGen: ImageGenTool;
  runId: string;
}

// The fully-automated visual stage: CONTENT MASTER -> TRUTH QA -> VISUAL STAGE,
// invoked explicitly per content item (not auto-triggered on every draft/edit) —
// this repo's "demand-driven execution" principle (CLAUDE.md) applies here exactly
// as it does to every head agent: image generation costs money per call, so
// nothing generates one without an explicit request. Requires a configured image
// provider (env.geminiImage) — when none is billed/available, use
// prepareVisualBrief + ingestManualVisualAsset instead (the browser-driven path).
export async function runVisualStage(input: RunVisualStageInput): Promise<VisualAsset> {
  const prepared = await prepareVisualBrief({
    contentId: input.contentId,
    pool: input.pool,
    llm: input.llm,
    runId: input.runId,
  });
  if (prepared.kind === 'terminal') return prepared.asset;

  try {
    const generated = await input.imageGen.generateImage({
      prompt: prepared.prompt,
      negativePrompt: prepared.negativePrompt,
      aspectRatio: prepared.aspectRatio,
      contentId: input.contentId,
      visualId: prepared.visualId,
    });

    return await finalizeVisualAsset({
      pool: input.pool,
      llm: input.llm,
      contentId: input.contentId,
      runId: input.runId,
      baseAsset: prepared.baseAsset,
      image: generated,
      storeAsset: (request) => input.imageGen.storeVisualAsset(request),
    });
  } catch (error) {
    const message = error instanceof ImageGenToolError ? error.message : String(error);
    return upsertVisualAsset(input.pool, {
      ...prepared.baseAsset,
      status: 'FAILED',
      qa: null,
      masterAsset: emptyMasterAsset,
      blockingReasons: [`Image generation failed: ${message}`],
    });
  }
}
