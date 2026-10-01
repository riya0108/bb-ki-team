import { getLatestVisualAssetForContent } from '@bb/db';
import type { Queryable } from '@bb/db';
import type { VisualAsset } from '@bb/shared-types';

export class VisualPendingReviewError extends Error {
  constructor(contentId: string, visualId: string) {
    super(
      `Content ${contentId} has a visual (${visualId}) still awaiting human review. Approve or ` +
        'reject it before publishing — publishing now would silently drop the image.',
    );
    this.name = 'VisualPendingReviewError';
  }
}

// An image exists and a human has not decided on it yet.
const PENDING_REVIEW_STATUSES = new Set(['NEEDS_REVIEW', 'QA_PASS']);

// Resolves the visual a publish connector should attach, if any. Uses the content's
// latest visual rather than the one keyed to the approved text version: visual and
// text approval are independent lifecycles (reviewVisualAsset.ts), so a text-only
// edit after the image was approved (e.g. fixing a typo) must not orphan it — that
// keyed lookup silently shipped text-only posts. A new visual generation already
// invalidates the content's approval (finalizeVisualAsset.ts), so the latest
// APPROVED visual is always one a human signed off on before the final approval.
// A visual still awaiting review blocks the publish instead of being dropped.
export async function resolveApprovedVisual(
  pool: Queryable,
  contentId: string,
): Promise<VisualAsset | null> {
  const visual = await getLatestVisualAssetForContent(pool, contentId);
  if (!visual) return null;
  if (PENDING_REVIEW_STATUSES.has(visual.status)) {
    throw new VisualPendingReviewError(contentId, visual.id);
  }
  return visual.status === 'APPROVED' &&
    visual.masterAsset.status === 'STORED' &&
    visual.masterAsset.assetUrl
    ? visual
    : null;
}
