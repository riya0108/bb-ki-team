import {
  getContentItemById,
  insertPublishEvent,
  listDueSchedules,
  listPublishEventsForContent,
  setContentItemApproval,
  setContentItemStatus,
  withTransaction,
} from '@bb/db';
import type { Pool, Queryable } from '@bb/db';
import type { ContentItem, PublishEvent } from '@bb/shared-types';

import { ContentItemNotFoundError } from './ledger.js';
import { assertTransition } from './stateMachine.js';

export class ContentNotApprovedError extends Error {
  constructor(contentId: string, status: string) {
    super(
      `Cannot publish/schedule content ${contentId}: status is "${status}", not "approved" ` +
        '(spec 15.2: publishing may only happen from an approved exact version).',
    );
    this.name = 'ContentNotApprovedError';
  }
}

export class ContentNotScheduledError extends Error {
  constructor(contentId: string, status: string) {
    super(
      `Cannot fire scheduled publish for content ${contentId}: status is "${status}", not "scheduled".`,
    );
    this.name = 'ContentNotScheduledError';
  }
}

// The tool-boundary contract every real platform connector implements (CLAUDE.md:
// "MCP is the tool boundary" — a future connector wraps an MCP client the same way
// packages/mcp-client's createLinkedinMcpClient does). No agent or workflow function
// may publish except through this interface, and no employee/specialist is allowed
// to publish independently (spec 1.1).
export interface PublishConnector {
  name: string;
  publish(item: ContentItem): Promise<{ platformPostId: string; platformUrl: string }>;
}

export interface ScheduleConnector {
  name: string;
  schedule(item: ContentItem, scheduledFor: Date): Promise<void>;
}

export interface PublishOutcome {
  item: ContentItem;
  event: PublishEvent;
}

// Narrows ContentItem's nullable approval fields to non-null, once, centrally —
// callers below read item.approvedVersion/approvedBy/approvedAt without repeated
// assertions, since this function is the only path that constructs the type.
interface ApprovedContentItem extends ContentItem {
  approvedVersion: number;
  approvedBy: string;
  approvedAt: string;
}

async function requireApprovedItem(db: Queryable, contentId: string): Promise<ApprovedContentItem> {
  const item = await getContentItemById(db, contentId);
  if (!item) throw new ContentItemNotFoundError(contentId);
  if (item.status !== 'approved' || !item.approvedVersion || !item.approvedBy || !item.approvedAt) {
    throw new ContentNotApprovedError(contentId, item.status);
  }
  return item as ApprovedContentItem;
}

// scheduled -> published (stateMachine.ts) reuses the same approvedVersion/approvedBy
// /approvedAt trail scheduling left intact — a scheduled item never loses its
// approval, it just waits for apps/worker to actually fire it.
async function requireScheduledItem(db: Queryable, contentId: string): Promise<ApprovedContentItem> {
  const item = await getContentItemById(db, contentId);
  if (!item) throw new ContentItemNotFoundError(contentId);
  if (
    item.status !== 'scheduled' ||
    !item.approvedVersion ||
    !item.approvedBy ||
    !item.approvedAt
  ) {
    throw new ContentNotScheduledError(contentId, item.status);
  }
  return item as ApprovedContentItem;
}

// Spec 15.3/15.4: every publish ATTEMPT is logged, whether it succeeds or fails — a
// missing connector is a real, loggable outcome, not an exception, since it's the
// expected state until a platform is actually wired up (spec 15.4: "never claim a
// post was published unless the connector confirms it" — the honest failure here is
// exactly that guarantee holding). Shared by requestPublish (an approved item, fired
// on demand) and firePendingSchedule (a scheduled item, fired by apps/worker once due).
async function attemptPublish(
  pool: Pool,
  item: ApprovedContentItem,
  connectors: Record<string, PublishConnector>,
): Promise<PublishOutcome> {
  const connector = connectors[item.platform];

  if (!connector) {
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      connector: 'none',
      result: 'failed',
      error: `No publish connector is configured for platform "${item.platform}" yet.`,
    });
    return { item, event };
  }

  try {
    const result = await connector.publish(item);
    assertTransition(item.status, 'published');
    const publishedItem = await setContentItemStatus(pool, item.id, 'published');
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      publishedAt: new Date().toISOString(),
      platformPostId: result.platformPostId,
      platformUrl: result.platformUrl,
      connector: connector.name,
      result: 'success',
    });
    return { item: publishedItem, event };
  } catch (error) {
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      connector: connector.name,
      result: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return { item, event };
  }
}

export async function requestPublish(
  pool: Pool,
  contentId: string,
  connectors: Record<string, PublishConnector>,
): Promise<PublishOutcome> {
  const item = await requireApprovedItem(pool, contentId);
  return attemptPublish(pool, item, connectors);
}

// Fires a single due schedule — called by requestPublish's scheduled-item counterpart,
// apps/worker's poll loop, never directly by a human-facing route (nothing publishes
// except through an approval-gated path; spec 15: no publish/schedule tool call is
// allowed except after an approval gate has recorded approval for this exact version).
export async function firePendingSchedule(
  pool: Pool,
  contentId: string,
  connectors: Record<string, PublishConnector>,
): Promise<PublishOutcome> {
  const item = await requireScheduledItem(pool, contentId);
  return attemptPublish(pool, item, connectors);
}

// What apps/worker calls on each tick: find every scheduled item whose target time
// has arrived and actually publish it, one at a time, logging every attempt via
// firePendingSchedule/attemptPublish regardless of outcome (spec 15.3/15.4).
export async function publishDueSchedules(
  pool: Pool,
  connectors: Record<string, PublishConnector>,
  asOf: Date = new Date(),
): Promise<PublishOutcome[]> {
  const due = await listDueSchedules(pool, asOf);
  const outcomes: PublishOutcome[] = [];
  for (const { contentId } of due) {
    outcomes.push(await firePendingSchedule(pool, contentId, connectors));
  }
  return outcomes;
}

// The dashboard's "modify schedule" action. requireScheduledItem (not
// requireApprovedItem) — unlike requestSchedule this never touches item.status,
// it stays 'scheduled' throughout — so it's callable any number of times while a
// schedule is still pending. Both registered ScheduleConnectors (x, blog) are
// no-ops that only let requestSchedule record a time in the first place (see
// xClient.ts/blogGitClient.ts), so calling .schedule() again here is side-effect-free;
// what actually moves the target time is the new publish_event row below —
// listDueSchedules (packages/db) picks the most recent successful schedule event
// per content item, so this one supersedes whatever was recorded before it.
export async function rescheduleContent(
  pool: Pool,
  contentId: string,
  scheduledFor: Date,
  connectors: Record<string, ScheduleConnector>,
): Promise<PublishOutcome> {
  const item = await requireScheduledItem(pool, contentId);
  const connector = connectors[item.platform];

  if (!connector) {
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      scheduledFor: scheduledFor.toISOString(),
      connector: 'none',
      result: 'failed',
      error: `No schedule connector is configured for platform "${item.platform}" yet.`,
    });
    return { item, event };
  }

  try {
    await connector.schedule(item, scheduledFor);
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      scheduledFor: scheduledFor.toISOString(),
      connector: connector.name,
      result: 'success',
    });
    return { item, event };
  } catch (error) {
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      scheduledFor: scheduledFor.toISOString(),
      connector: connector.name,
      result: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return { item, event };
  }
}

// The dashboard's "cancel schedule" action: normally returns the item to 'approved'
// (its approval, unlike an edit's, is still valid — the content itself never
// changed, only the decision to publish it automatically) so apps/worker's
// listDueSchedules (which only fires content_items.status = 'scheduled') stops
// picking it up. A human can re-schedule or publish on demand from 'approved' same
// as any other approved item.
//
// Guards against a real inconsistent state a pre-fix version of addRevision could
// leave behind: an item edited while scheduled that kept status='scheduled' with
// approvedVersion still pinned to the pre-edit version instead of being cleared
// (fixed in ledger.ts, but rows created before that fix can still carry it). Setting
// status to 'approved' in that state would violate the approved_matches_current
// CHECK constraint (packages/db migration 0005) and, worse, would be a lie — the
// CURRENT version was never actually approved. Route those to 'in_review' instead,
// clearing the stale approval — exactly what the fixed addRevision would have done
// at edit time.
export async function cancelSchedule(pool: Pool, contentId: string): Promise<PublishOutcome> {
  // One transaction: the status change and its audit event must land together —
  // a partial write here (e.g. status flips but the event insert fails) would
  // silently strand the item in a state with no record of why, exactly the kind of
  // inconsistency this function's own defensive branch above exists to clean up.
  return withTransaction(pool, async (client) => {
    const item = await requireScheduledItem(client, contentId);
    const approvalStillValid = item.approvedVersion === item.currentVersion;
    const targetStatus = approvalStillValid ? 'approved' : 'in_review';
    assertTransition(item.status, targetStatus);
    const cancelledItem = approvalStillValid
      ? await setContentItemStatus(client, item.id, 'approved')
      : await setContentItemApproval(client, item.id, null);

    const priorEvents = await listPublishEventsForContent(client, contentId);
    const activeSchedule = priorEvents.find((e) => e.result === 'success' && e.scheduledFor !== null);

    const event = await insertPublishEvent(client, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      scheduledFor: activeSchedule?.scheduledFor ?? null,
      connector: 'dashboard',
      result: 'cancelled',
    });

    return { item: cancelledItem, event };
  });
}

export async function requestSchedule(
  pool: Pool,
  contentId: string,
  scheduledFor: Date,
  connectors: Record<string, ScheduleConnector>,
): Promise<PublishOutcome> {
  const item = await requireApprovedItem(pool, contentId);
  const connector = connectors[item.platform];

  if (!connector) {
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      scheduledFor: scheduledFor.toISOString(),
      connector: 'none',
      result: 'failed',
      error: `No schedule connector is configured for platform "${item.platform}" yet.`,
    });
    return { item, event };
  }

  try {
    await connector.schedule(item, scheduledFor);
    assertTransition(item.status, 'scheduled');
    const scheduledItem = await setContentItemStatus(pool, item.id, 'scheduled');
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      scheduledFor: scheduledFor.toISOString(),
      connector: connector.name,
      result: 'success',
    });
    return { item: scheduledItem, event };
  } catch (error) {
    const event = await insertPublishEvent(pool, {
      contentId: item.id,
      platform: item.platform,
      version: item.approvedVersion,
      approvedBy: item.approvedBy,
      approvedAt: item.approvedAt,
      scheduledFor: scheduledFor.toISOString(),
      connector: connector.name,
      result: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return { item, event };
  }
}
