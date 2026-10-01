import { randomUUID } from 'node:crypto';

import { getContentItemById, getLatestVisualAssetForContent, upsertVisualAsset } from '@bb/db';
import type { Queryable } from '@bb/db';
import type { ImageGenTool } from '@bb/mcp-client';
import type { VisualAsset } from '@bb/shared-types';

import { VisualContentNotFoundError } from './errors.js';

export interface UploadUserVisualAssetInput {
  contentId: string;
  pool: Queryable;
  // Reuses ImageGenTool only for storeVisualAsset (Supabase) — nothing is generated.
  imageGen: ImageGenTool;
  base64Data: string;
  mimeType: string;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? 'png';
}

// The user's own upload IS the human decision on the image, so it is stored as
// APPROVED directly: no brief required, no LLM visual QA that could REJECT it, no
// separate "Approve visual" click, and the content's text approval is left alone
// (unlike finalizeVisualAsset, which invalidates it for an agent-made image nobody
// has looked at yet). Every publish connector picks it up via the content's latest
// APPROVED visual (packages/mcp-client/src/approvedVisual.ts).
export async function uploadUserVisualAsset(
  input: UploadUserVisualAssetInput,
): Promise<VisualAsset> {
  const item = await getContentItemById(input.pool, input.contentId);
  if (!item) throw new VisualContentNotFoundError(input.contentId);

  // Keep the brief's concept (used as blog cover alt text) when the user is
  // attaching the image a prepared brief asked for.
  const existing = await getLatestVisualAssetForContent(input.pool, input.contentId);
  const sameVersion = existing?.version === item.currentVersion ? existing : null;

  const visualId = randomUUID();
  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${input.contentId}/${visualId}/master.${extensionFor(input.mimeType)}`;
  const stored = await input.imageGen.storeVisualAsset({
    path,
    base64Data: input.base64Data,
    mimeType: input.mimeType,
  });

  const createdAt = now.toISOString();
  return upsertVisualAsset(input.pool, {
    id: visualId,
    contentId: input.contentId,
    version: item.currentVersion,
    status: 'APPROVED',
    visualDecision: sameVersion?.visualDecision ?? null,
    visualType: sameVersion?.visualType ?? null,
    concept: sameVersion?.concept ?? null,
    rationale: sameVersion?.rationale ?? null,
    sourceMode: 'user_supplied_asset',
    isAiGenerated: sameVersion?.isAiGenerated ?? false,
    isIllustrative: sameVersion?.isIllustrative ?? false,
    disclosureRequired: sameVersion?.disclosureRequired ?? false,
    generationBrief: sameVersion?.generationBrief ?? null,
    visualClaims: sameVersion?.visualClaims ?? [],
    fictionalOrIllustrativeElements: sameVersion?.fictionalOrIllustrativeElements ?? [],
    riskFlags: [],
    qa: null,
    masterAsset: {
      status: 'STORED',
      provider: 'user-upload',
      model: 'user-upload',
      generationId: `upload:${visualId}`,
      assetPath: stored.assetPath,
      assetUrl: stored.assetUrl,
      mimeType: input.mimeType,
      width: null,
      height: null,
      createdAt,
    },
    platformVariants: {},
    blockingReasons: [],
    createdAt,
    updatedAt: createdAt,
  });
}
