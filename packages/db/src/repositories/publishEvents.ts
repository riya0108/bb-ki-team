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

export async function insertPublishEvent(db: Queryable, input: NewPublishEventInput): Promise<PublishEvent> {
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

export async function listPublishEventsForContent(db: Queryable, contentId: string): Promise<PublishEvent[]> {
  const result = await db.query<PublishEventRow>(
    'SELECT * FROM publish_events WHERE content_id = $1 ORDER BY created_at DESC',
    [contentId],
  );
  return result.rows.map(mapRow);
}
