import { getLatestVisualAssetForContent, upsertVisualAsset } from '@bb/db';
import type { Queryable } from '@bb/db';
import type { VisualAsset } from '@bb/shared-types';
import { invalidateApprovalForVisualChange } from '@bb/workflows';

import { VisualNotReviewableError } from './errors.js';

// Statuses a human can act on: NEEDS_REVIEW is the normal "pixels exist, LLM QA
// passed the checkable dimensions, a human still has to look at the actual image"
// state (see finalizeVisualAsset.ts); QA_PASS is kept as a reviewable status too in
// case a future QA path ever produces it directly.
const REVIEWABLE_STATUSES = new Set(['NEEDS_REVIEW', 'QA_PASS']);

async function loadReviewableAsset(
  pool: Queryable,
  contentId: string,
  visualId: string,
): Promise<VisualAsset> {
  const existing = await getLatestVisualAssetForContent(pool, contentId);
  if (!existing || existing.id !== visualId || !REVIEWABLE_STATUSES.has(existing.status)) {
    throw new VisualNotReviewableError(contentId, visualId, existing?.status ?? 'NONE');
  }
  return existing;
}

export interface ApproveVisualAssetInput {
  pool: Queryable;
  contentId: string;
  visualId: string;
}

// The human decision this VisualAsset's NEEDS_REVIEW status has been waiting on
// (visualQuality can never be auto-PASSed — see visualAsset.ts's VisualQaSchema
// comment). Approving does not touch the content item's own approval state; the two
// lifecycles are independent (a text edit after this still only invalidates the
// text approval, and a new visual generation still invalidates this one via
// finalizeVisualAsset's invalidateApprovalForVisualChange call).
export async function approveVisualAsset(input: ApproveVisualAssetInput): Promise<VisualAsset> {
  const asset = await loadReviewableAsset(input.pool, input.contentId, input.visualId);
  return upsertVisualAsset(input.pool, { ...asset, status: 'APPROVED', blockingReasons: [] });
}

export interface RejectVisualAssetInput {
  pool: Queryable;
  contentId: string;
  visualId: string;
  reason: string;
}

// Rejecting a visual that had already been folded into an approved/scheduled
// package must pull that package back into review — the same invariant
// finalizeVisualAsset enforces for a brand-new visual (spec: "any post-approval
// visual change invalidates approval for the affected package"). A rejection is
// exactly such a change: the package a human approved assumed this image would run
// with it, and that's no longer true.
export async function rejectVisualAsset(input: RejectVisualAssetInput): Promise<VisualAsset> {
  const asset = await loadReviewableAsset(input.pool, input.contentId, input.visualId);
  await invalidateApprovalForVisualChange(input.pool, input.contentId);
  return upsertVisualAsset(input.pool, {
    ...asset,
    status: 'REJECTED',
    blockingReasons: [input.reason],
  });
}
