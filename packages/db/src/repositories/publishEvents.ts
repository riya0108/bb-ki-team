import type { NewPublishEventInput, PublishEvent } from '@bb/shared-types';
import { PublishEventSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface PublishEventRow {
  id: string;
  content_id: string;
  platform: string;
  version: number;
  approved_by: string;
  approved_at: Date;
  scheduled_for: Date | null;
  published_at: Date | null;
  platform_post_id: string | null;
  platform_url: string | null;
  connector: string;
  result: string;
  error: string | null;
  created_at: Date;
}

function mapRow(row: PublishEventRow): PublishEvent {
  return PublishEventSchema.parse({
    id: row.id,
    contentId: row.content_id,
    platform: row.platform,
    version: row.version,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at.toISOString(),
    scheduledFor: row.scheduled_for?.toISOString() ?? null,
    publishedAt: row.published_at?.toISOString() ?? null,
    platformPostId: row.platform_post_id,
    platformUrl: row.platform_url,
    connector: row.connector,
    result: row.result,
    error: row.error,
    createdAt: row.created_at.toISOString(),
  });
}

export async function insertPublishEvent(
  db: Queryable,
  input: NewPublishEventInput,
): Promise<PublishEvent> {
  const result = await db.query<PublishEventRow>(
    `INSERT INTO publish_events
       (content_id, platform, version, approved_by, approved_at, scheduled_for, published_at,
        platform_post_id, platform_url, connector, result, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::publish_result, $12)
     RETURNING *`,
    [
      input.contentId,
      input.platform,
      input.version,
      input.approvedBy,
      input.approvedAt,
      input.scheduledFor ?? null,
      input.publishedAt ?? null,
      input.platformPostId ?? null,
      input.platformUrl ?? null,
      input.connector,
      input.result,
      input.error ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertPublishEvent: insert returned no row');
  return mapRow(row);
}

export async function listPublishEventsForContent(
  db: Queryable,
  contentId: string,
): Promise<PublishEvent[]> {
  const result = await db.query<PublishEventRow>(
    'SELECT * FROM publish_events WHERE content_id = $1 ORDER BY created_at DESC',
    [contentId],
  );
  return result.rows.map(mapRow);
}

export interface DueSchedule {
  contentId: string;
  scheduledFor: string;
}

// The most recent successful "schedule" attempt per content item still sitting in
// content_items.status = 'scheduled' (the authoritative "hasn't fired yet" signal —
// firing inserts a SEPARATE publish_event row rather than updating this one, so
// checking published_at on the scheduling row itself is not enough: it stays null
// forever even after a later event successfully publishes the item) whose target
// time has arrived. DISTINCT ON picks the latest scheduling event per item so a
// prior failed publish attempt for the same item can't be mistaken for its schedule.
export async function listDueSchedules(db: Queryable, asOf: Date): Promise<DueSchedule[]> {
  const result = await db.query<{ content_id: string; scheduled_for: Date }>(
    `SELECT DISTINCT ON (pe.content_id) pe.content_id, pe.scheduled_for
     FROM publish_events pe
     JOIN content_items ci ON ci.id = pe.content_id
     WHERE pe.result = 'success'
       AND pe.scheduled_for IS NOT NULL
       AND ci.status = 'scheduled'
       AND pe.scheduled_for <= $1
     ORDER BY pe.content_id, pe.created_at DESC`,
    [asOf],
  );
  return result.rows.map((row) => ({
    contentId: row.content_id,
    scheduledFor: row.scheduled_for.toISOString(),
  }));
}
