import type { ContentItem, ContentStatus, NewContentItemInput, RiskLevel } from '@bb/shared-types';
import { ContentItemSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface ContentItemRow {
  id: string;
  platform: string;
  created_at: Date;
  updated_at: Date;
  created_by_agent: string;
  mode: string;
  topic: string | null;
  content_pillar: string | null;
  source_ids: string[];
  source_urls: string[];
  core_claim: string | null;
  angle: string | null;
  content_dna_version: number;
  current_version: number;
  current_text: string;
  status: string;
  risk_level: string;
  approved_version: number | null;
  approved_at: Date | null;
  approved_by: string | null;
  package: unknown;
}

function mapRow(row: ContentItemRow): ContentItem {
  return ContentItemSchema.parse({
    id: row.id,
    platform: row.platform,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdByAgent: row.created_by_agent,
    mode: row.mode,
    topic: row.topic,
    contentPillar: row.content_pillar,
    sourceIds: row.source_ids,
    sourceUrls: row.source_urls,
    coreClaim: row.core_claim,
    angle: row.angle,
    contentDnaVersion: row.content_dna_version,
    currentVersion: row.current_version,
    currentText: row.current_text,
    status: row.status,
    riskLevel: row.risk_level,
    approvedVersion: row.approved_version,
    approvedAt: row.approved_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    package: row.package,
  });
}

export async function insertContentItem(db: Queryable, input: NewContentItemInput): Promise<ContentItem> {
  const result = await db.query<ContentItemRow>(
    `INSERT INTO content_items
       (platform, created_by_agent, mode, topic, content_pillar, source_ids, source_urls,
        core_claim, angle, content_dna_version, current_text, risk_level, package)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::risk_level, $13)
     RETURNING *`,
    [
      input.platform,
      input.createdByAgent,
      input.mode,
      input.topic ?? null,
      input.contentPillar ?? null,
      input.sourceIds ?? [],
      input.sourceUrls ?? [],
      input.coreClaim ?? null,
      input.angle ?? null,
      input.contentDnaVersion,
      input.text,
      input.riskLevel ?? 'low',
      input.package ? JSON.stringify(input.package) : null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertContentItem: insert returned no row');
  return mapRow(row);
}

export async function getContentItemById(db: Queryable, id: string): Promise<ContentItem | null> {
  const result = await db.query<ContentItemRow>('SELECT * FROM content_items WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function listContentItems(
  db: Queryable,
  filter?: { status?: ContentStatus; platform?: string },
): Promise<ContentItem[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter?.status) {
    values.push(filter.status);
    conditions.push(`status = $${values.length}`);
  }
  if (filter?.platform) {
    values.push(filter.platform);
    conditions.push(`platform = $${values.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query<ContentItemRow>(
    `SELECT * FROM content_items ${where} ORDER BY created_at DESC`,
    values,
  );
  return result.rows.map(mapRow);
}

// The most recent EditorialBrief (stored inside content_items.package by the
// editorial-intelligence pipeline) for a normalized topic, created after `since` —
// lets a second platform reuse one researched brief instead of researching the same
// story again. Returns the raw JSON; the caller validates it against its schema.
export async function findRecentEditorialBrief(
  db: Queryable,
  topicKey: string,
  since: Date,
): Promise<unknown> {
  const result = await db.query<{ brief: unknown }>(
    `SELECT package->'editorialBrief' AS brief
     FROM content_items
     WHERE package->'editorialBrief'->>'topicKey' = $1
       AND package->'editorialBrief'->>'kind' = 'researched'
       AND created_at >= $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [topicKey, since],
  );
  return result.rows[0]?.brief ?? null;
}

// Every content item drafted from the same EditorialBrief — the cross-platform
// consistency check compares a new draft against these.
export async function listContentItemsByEditorialBriefId(db: Queryable, briefId: string): Promise<ContentItem[]> {
  const result = await db.query<ContentItemRow>(
    `SELECT * FROM content_items
     WHERE package->'editorialBrief'->>'id' = $1
     ORDER BY created_at DESC`,
    [briefId],
  );
  return result.rows.map(mapRow);
}

export async function updateContentItemText(
  db: Queryable,
  id: string,
  input: { version: number; text: string; riskLevel?: RiskLevel; package?: Record<string, unknown> | null },
): Promise<ContentItem> {
  const result = await db.query<ContentItemRow>(
    `UPDATE content_items
     SET current_version = $2,
         current_text = $3,
         risk_level = COALESCE($4::risk_level, risk_level),
         package = CASE WHEN $5::boolean THEN $6::jsonb ELSE package END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.version,
      input.text,
      input.riskLevel ?? null,
      input.package !== undefined,
      input.package !== undefined ? JSON.stringify(input.package) : null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`updateContentItemText: no content item with id ${id}`);
  return mapRow(row);
}

export async function setContentItemStatus(db: Queryable, id: string, status: ContentStatus): Promise<ContentItem> {
  const result = await db.query<ContentItemRow>(
    'UPDATE content_items SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, status],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`setContentItemStatus: no content item with id ${id}`);
  return mapRow(row);
}

export async function setContentItemApproval(
  db: Queryable,
  id: string,
  approval: { version: number; approvedBy: string } | null,
): Promise<ContentItem> {
  const approvedAt = approval ? new Date() : null;
  const result = await db.query<ContentItemRow>(
    `UPDATE content_items
     SET status = $2,
         approved_version = $3,
         approved_at = $4,
         approved_by = $5,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, approval ? 'approved' : 'in_review', approval?.version ?? null, approvedAt, approval?.approvedBy ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`setContentItemApproval: no content item with id ${id}`);
  return mapRow(row);
}
