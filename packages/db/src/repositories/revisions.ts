import type { NewRevisionInput, Revision } from '@bb/shared-types';
import { RevisionSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface RevisionRow {
  id: string;
  content_id: string;
  version: number;
  created_at: Date;
  change_type: string;
  previous_text: string | null;
  new_text: string;
  changed_by: string;
  changed_by_id: string | null;
  reason: string | null;
  approval_invalidated: boolean;
}

function mapRow(row: RevisionRow): Revision {
  return RevisionSchema.parse({
    id: row.id,
    contentId: row.content_id,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    changeType: row.change_type,
    previousText: row.previous_text,
    newText: row.new_text,
    changedBy: row.changed_by,
    changedById: row.changed_by_id,
    reason: row.reason,
    approvalInvalidated: row.approval_invalidated,
  });
}

export async function insertRevision(
  db: Queryable,
  contentId: string,
  version: number,
  previousText: string | null,
  input: NewRevisionInput & { approvalInvalidated?: boolean },
): Promise<Revision> {
  const result = await db.query<RevisionRow>(
    `INSERT INTO revisions
       (content_id, version, change_type, previous_text, new_text, changed_by, changed_by_id, reason, approval_invalidated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false))
     RETURNING *`,
    [
      contentId,
      version,
      input.changeType,
      previousText,
      input.newText,
      input.changedBy,
      input.changedById ?? null,
      input.reason ?? null,
      input.approvalInvalidated ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertRevision: insert returned no row');
  return mapRow(row);
}

export async function listRevisionsForContent(db: Queryable, contentId: string): Promise<Revision[]> {
  const result = await db.query<RevisionRow>(
    'SELECT * FROM revisions WHERE content_id = $1 ORDER BY version ASC',
    [contentId],
  );
  return result.rows.map(mapRow);
}
