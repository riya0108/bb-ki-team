import type { QaOverallStatus, QaResult } from '@bb/shared-types';
import { QaResultSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface QaResultRow {
  id: string;
  content_id: string;
  version: number;
  overall_status: string;
  result: unknown;
  publish_allowed: boolean;
  created_at: Date;
}

export interface StoredQaResult {
  id: string;
  contentId: string;
  version: number;
  result: QaResult;
  createdAt: string;
}

function mapRow(row: QaResultRow): StoredQaResult {
  return {
    id: row.id,
    contentId: row.content_id,
    version: row.version,
    result: QaResultSchema.parse(row.result),
    createdAt: row.created_at.toISOString(),
  };
}

export async function insertQaResult(
  db: Queryable,
  contentId: string,
  version: number,
  result: QaResult,
): Promise<StoredQaResult> {
  const overallStatus: QaOverallStatus = result.overallStatus;
  const inserted = await db.query<QaResultRow>(
    `INSERT INTO qa_results (content_id, version, overall_status, result, publish_allowed)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (content_id, version) DO UPDATE
       SET overall_status = EXCLUDED.overall_status, result = EXCLUDED.result, publish_allowed = EXCLUDED.publish_allowed
     RETURNING *`,
    [contentId, version, overallStatus, JSON.stringify(result), result.publishAllowed],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('insertQaResult: insert returned no row');
  return mapRow(row);
}

export async function getQaResultForVersion(
  db: Queryable,
  contentId: string,
  version: number,
): Promise<StoredQaResult | null> {
  const result = await db.query<QaResultRow>('SELECT * FROM qa_results WHERE content_id = $1 AND version = $2', [
    contentId,
    version,
  ]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
