import type { LlmClient } from '@bb/core';
import { upsertVisualAsset } from '@bb/db';
import type { Queryable } from '@bb/db';
import { ImageGenToolError } from '@bb/mcp-client';
import type { StoredVisualAsset } from '@bb/mcp-client';
import type { VisualAsset } from '@bb/shared-types';
import { invalidateApprovalForVisualChange } from '@bb/workflows';

import { emptyMasterAsset } from './prepareVisualBrief.js';
import type { VisualAssetBase } from './prepareVisualBrief.js';
import { runVisualQa } from './visualQa.js';

export interface GeneratedImageForFinalize {
  provider: string;
  model: string;
  generationId: string;
  base64Data: string;
  mimeType: string;
}

export interface FinalizeVisualAssetInput {
  pool: Queryable;
  llm: LlmClient;
  contentId: string;
  runId: string;
  baseAsset: VisualAssetBase;
  image: GeneratedImageForFinalize;
  storeAsset: (request: {
    path: string;
    base64Data: string;
    mimeType: string;
  }) => Promise<StoredVisualAsset>;
}

function extensionFor(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'jpg' : 'png';
}

// The "QA + store" half of the visual stage, shared by the automated path
// (runVisualStage.ts, bytes come from a configured image provider) and the manual
// path (ingestManualVisualAsset.ts, bytes come from a file a human/Claude generated
// via a browser session). Never called with unverified bytes — visual QA always
// runs first, and truth/evidence/identity FAIL blocks storage outright.
export async function finalizeVisualAsset(input: FinalizeVisualAssetInput): Promise<VisualAsset> {
  const { baseAsset } = input;
  const stepId = `visual:${baseAsset.id}`;

  const qa = await runVisualQa({
    concept: baseAsset.concept ?? '',
    rationale: baseAsset.rationale ?? '',
    visualClaims: baseAsset.visualClaims,
    isIllustrative: baseAsset.isIllustrative,
    disclosureRequired: baseAsset.disclosureRequired,
    llm: input.llm,
    runId: input.runId,
    stepId,
  });

  if (qa.status === 'FAIL') {
    return upsertVisualAsset(input.pool, {
      ...baseAsset,
      status: 'REJECTED',
      qa,
      masterAsset: emptyMasterAsset,
      blockingReasons: qa.issues,
    });
  }

  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${input.contentId}/${baseAsset.id}/master.${extensionFor(input.image.mimeType)}`;

  try {
    const stored = await input.storeAsset({
      path,
      base64Data: input.image.base64Data,
      mimeType: input.image.mimeType,
    });
    // A real new visual now exists for this version — if the content was already
    // approved (or scheduled), that approval no longer covers what a human actually
    // signed off on, so it must be re-reviewed (integration contract: "any
    // post-approval visual change invalidates approval for the affected package").
    await invalidateApprovalForVisualChange(input.pool, input.contentId);
    return upsertVisualAsset(input.pool, {
      ...baseAsset,
      status: 'NEEDS_REVIEW',
      qa,
      masterAsset: {
        status: 'STORED',
        provider: input.image.provider,
        model: input.image.model,
        generationId: input.image.generationId,
        assetPath: stored.assetPath,
        assetUrl: stored.assetUrl,
        mimeType: input.image.mimeType,
        width: null,
        height: null,
        createdAt: new Date().toISOString(),
      },
      blockingReasons: [],
    });
  } catch (error) {
    const message = error instanceof ImageGenToolError ? error.message : String(error);
    return upsertVisualAsset(input.pool, {
      ...baseAsset,
      status: 'FAILED',
      qa,
      masterAsset: emptyMasterAsset,
      blockingReasons: [`Asset storage failed: ${message}`],
    });
  }
}
