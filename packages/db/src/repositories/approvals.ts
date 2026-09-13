import type { Queryable } from '../pool.js';

export interface ApprovalRecord {
  id: string;
  contentId: string;
  version: number;
  approvedBy: string;
  approvedAt: string;
  invalidatedAt: string | null;
  invalidatedByRevisionId: string | null;
}

interface ApprovalRow {
  id: string;
  content_id: string;
  version: number;
  approved_by: string;
  approved_at: Date;
  invalidated_at: Date | null;
  invalidated_by_revision_id: string | null;
}

function mapRow(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    contentId: row.content_id,
    version: row.version,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at.toISOString(),
    invalidatedAt: row.invalidated_at?.toISOString() ?? null,
    invalidatedByRevisionId: row.invalidated_by_revision_id,
  };
}

export async function insertApproval(
  db: Queryable,
  input: { contentId: string; version: number; approvedBy: string },
): Promise<ApprovalRecord> {
  const result = await db.query<ApprovalRow>(
    'INSERT INTO approvals (content_id, version, approved_by) VALUES ($1, $2, $3) RETURNING *',
    [input.contentId, input.version, input.approvedBy],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertApproval: insert returned no row');
  return mapRow(row);
}

export async function getOpenApprovalForContent(db: Queryable, contentId: string): Promise<ApprovalRecord | null> {
  const result = await db.query<ApprovalRow>(
    'SELECT * FROM approvals WHERE content_id = $1 AND invalidated_at IS NULL ORDER BY approved_at DESC LIMIT 1',
    [contentId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function closeApproval(db: Queryable, id: string, invalidatedByRevisionId: string): Promise<void> {
  await db.query('UPDATE approvals SET invalidated_at = now(), invalidated_by_revision_id = $2 WHERE id = $1', [
    id,
    invalidatedByRevisionId,
  ]);
}
