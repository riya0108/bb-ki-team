import { getContentItemById, insertPublishEvent, setContentItemStatus } from '@bb/db';
import type { Pool } from '@bb/db';
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

async function requireApprovedItem(db: Pool, contentId: string): Promise<ApprovedContentItem> {
  const item = await getContentItemById(db, contentId);
  if (!item) throw new ContentItemNotFoundError(contentId);
  if (item.status !== 'approved' || !item.approvedVersion || !item.approvedBy || !item.approvedAt) {
    throw new ContentNotApprovedError(contentId, item.status);
  }
  return item as ApprovedContentItem;
}

// Spec 15.3/15.4: every publish ATTEMPT is logged, whether it succeeds or fails — a
// missing connector is a real, loggable outcome, not an exception, since it's the
// expected state until a platform is actually wired up (spec 15.4: "never claim a
// post was published unless the connector confirms it" — the honest failure here is
// exactly that guarantee holding). Only an invalid request (wrong status) throws,
// since that's rejected before any attempt is even logged.
export async function requestPublish(
  pool: Pool,
  contentId: string,
  connectors: Record<string, PublishConnector>,
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
