import {
  closeApproval,
  getContentItemById,
  getOpenApprovalForContent,
  insertApproval,
  insertContentItem,
  insertQaResult,
  insertRevision,
  listContentItems as dbListContentItems,
  setContentItemApproval,
  setContentItemStatus,
  updateContentItemText,
  withTransaction,
} from '@bb/db';
import type { Pool, Queryable } from '@bb/db';
import type {
  ContentItem,
  ContentStatus,
  NewContentItemInput,
  NewRevisionInput,
  QaResult,
  Revision,
} from '@bb/shared-types';

import { assertTransition } from './stateMachine.js';

export class StaleApprovalVersionError extends Error {
  constructor(contentId: string, requestedVersion: number, currentVersion: number) {
    super(
      `Cannot approve content ${contentId} at version ${requestedVersion}: current version is ${currentVersion}. ` +
        'Approval always applies to the exact current version (spec 15.4: never reuse an old approval).',
    );
    this.name = 'StaleApprovalVersionError';
  }
}

export class ContentItemNotFoundError extends Error {
  constructor(id: string) {
    super(`No content item with id ${id}`);
    this.name = 'ContentItemNotFoundError';
  }
}

async function requireContentItem(db: Queryable, id: string): Promise<ContentItem> {
  const item = await getContentItemById(db, id);
  if (!item) throw new ContentItemNotFoundError(id);
  return item;
}

export async function createContentItem(
  db: Queryable,
  input: NewContentItemInput,
): Promise<ContentItem> {
  return insertContentItem(db, input);
}

// draft -> in_review: the point at which a freshly generated item is considered
// "ready for review" and returned to the human approver.
export async function submitForReview(db: Queryable, id: string): Promise<ContentItem> {
  const current = await requireContentItem(db, id);
  assertTransition(current.status, 'in_review');
  return setContentItemStatus(db, id, 'in_review');
}

export async function getContentItem(db: Queryable, id: string): Promise<ContentItem | null> {
  return getContentItemById(db, id);
}

export async function listContentItems(
  db: Queryable,
  filter?: { status?: ContentStatus; platform?: string },
): Promise<ContentItem[]> {
  return dbListContentItems(db, filter);
}

export async function recordQaResult(
  db: Queryable,
  contentId: string,
  version: number,
  qa: QaResult,
): Promise<void> {
  await insertQaResult(db, contentId, version, qa);
}

export interface AddRevisionResult {
  item: ContentItem;
  revision: Revision;
}

// The single most load-bearing function in Phase 1 (spec 15.2): every edit gets
// its own revision row, and if the item being edited was approved, scheduled (or
// already back in changes_requested), the new text always resubmits it to
// in_review — an edited version can never coast on a prior approval, and a
// pending schedule can never fire the pre-edit text (apps/worker's
// listDueSchedules only picks up content_items.status = 'scheduled', so flipping
// out of that status here is what actually stops the stale version from
// publishing). All of this happens in one transaction so the invariant can never
// be observed half-applied.
export async function addRevision(
  pool: Pool,
  contentId: string,
  // `package` isn't part of the revisions table (NewRevisionInput) — it's an optional
  // passthrough to content_items.package for platforms whose content isn't a flat
  // string (X threads, Instagram carousels/reels, YouTube Shorts scripts). Omit it
  // entirely to leave the item's existing package untouched.
  input: NewRevisionInput & { package?: Record<string, unknown> | null },
): Promise<AddRevisionResult> {
  return withTransaction(pool, async (client) => {
    const current = await requireContentItem(client, contentId);
    const newVersion = current.currentVersion + 1;
    const hadApproval = current.status === 'approved' || current.status === 'scheduled';
    const needsReReview = hadApproval || current.status === 'changes_requested';

    const revision = await insertRevision(client, contentId, newVersion, current.currentText, {
      ...input,
      approvalInvalidated: hadApproval,
    });

    // Clear the approval / flip status to in_review BEFORE bumping current_version
    // below. Order matters: the approved_matches_current CHECK constraint
    // (packages/db migration 0005) requires approved_version === current_version
    // whenever status = 'approved', and each UPDATE is checked independently —
    // bumping current_version first would transiently violate it.
    if (needsReReview) {
      assertTransition(current.status, 'in_review');
      if (hadApproval) {
        await setContentItemApproval(client, contentId, null);
      } else {
        await setContentItemStatus(client, contentId, 'in_review');
      }
    }

    const item = await updateContentItemText(client, contentId, {
      version: newVersion,
      text: input.newText,
      ...(input.package !== undefined ? { package: input.package } : {}),
    });

    if (hadApproval) {
      const openApproval = await getOpenApprovalForContent(client, contentId);
      if (openApproval) {
        await closeApproval(client, openApproval.id, revision.id);
      }
    }

    return { item, revision };
  });
}

export async function recordApproval(
  pool: Pool,
  contentId: string,
  version: number,
  approvedBy: string,
): Promise<ContentItem> {
  return withTransaction(pool, async (client) => {
    const current = await requireContentItem(client, contentId);
    assertTransition(current.status, 'approved');
    if (current.currentVersion !== version) {
      throw new StaleApprovalVersionError(contentId, version, current.currentVersion);
    }
    await insertApproval(client, { contentId, version, approvedBy });
    return setContentItemApproval(client, contentId, { version, approvedBy });
  });
}

// Feedback text isn't persisted to a dedicated column/table in Phase 1 — there's
// no reviewer-comment schema yet, only the status transition itself. Callers
// (apps/api) are expected to log the feedback text via the structured logger if
// they want it retained; revisit if Phase 2+ needs a durable comment thread.
export async function requestChanges(
  db: Queryable,
  id: string,
  _feedback: string,
): Promise<ContentItem> {
  const current = await requireContentItem(db, id);
  assertTransition(current.status, 'changes_requested');
  return setContentItemStatus(db, id, 'changes_requested');
}

export async function reject(db: Queryable, id: string, _reason: string): Promise<ContentItem> {
  const current = await requireContentItem(db, id);
  assertTransition(current.status, 'rejected');
  return setContentItemStatus(db, id, 'rejected');
}

// A new/replaced visual asset for the CURRENT text version invalidates approval the
// same way a text edit does (addRevision's hadApproval branch above), but without
// bumping current_version — the text itself did not change (BB-Visual-Agent-Skill's
// integration contract: "any post-approval visual change invalidates approval for
// the affected package"). No-op when the item isn't currently approved/scheduled,
// so calling this after every visual stage run is always safe.
export async function invalidateApprovalForVisualChange(
  db: Queryable,
  contentId: string,
): Promise<ContentItem> {
  const current = await requireContentItem(db, contentId);
  if (current.status !== 'approved' && current.status !== 'scheduled') return current;
  assertTransition(current.status, 'in_review');
  return setContentItemApproval(db, contentId, null);
}
