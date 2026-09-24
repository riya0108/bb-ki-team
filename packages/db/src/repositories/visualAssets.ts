import type { VisualAsset, VisualDecision, VisualStatus } from '@bb/shared-types';
import { VisualAssetSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface VisualAssetRow {
  content_id: string;
  version: number;
  status: string;
  visual_decision: string | null;
  asset: unknown;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: VisualAssetRow): VisualAsset {
  return VisualAssetSchema.parse(row.asset);
}

// Upserts by (contentId, version) — re-running the visual stage for the same content
// version (e.g. after a provider failure, or a QA-driven regeneration) replaces the
// prior attempt for that version rather than accumulating duplicates. A text edit
// that bumps content_items.current_version always inserts a fresh row instead,
// preserving prior versions' visual history for audit (CLAUDE.md: all important
// decisions must be auditable).
export async function upsertVisualAsset(db: Queryable, asset: VisualAsset): Promise<VisualAsset> {
  const status: VisualStatus = asset.status;
  const visualDecision: VisualDecision | null = asset.visualDecision;
  const inserted = await db.query<VisualAssetRow>(
    `INSERT INTO visual_assets (content_id, version, status, visual_decision, asset, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (content_id, version) DO UPDATE
       SET status = EXCLUDED.status,
           visual_decision = EXCLUDED.visual_decision,
           asset = EXCLUDED.asset,
           updated_at = now()
     RETURNING *`,
    [asset.contentId, asset.version, status, visualDecision, JSON.stringify(asset)],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('upsertVisualAsset: insert returned no row');
  return mapRow(row);
}

export async function getVisualAssetForVersion(
  db: Queryable,
  contentId: string,
  version: number,
): Promise<VisualAsset | null> {
  const result = await db.query<VisualAssetRow>(
    'SELECT * FROM visual_assets WHERE content_id = $1 AND version = $2',
    [contentId, version],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function getLatestVisualAssetForContent(
  db: Queryable,
  contentId: string,
): Promise<VisualAsset | null> {
  const result = await db.query<VisualAssetRow>(
    'SELECT * FROM visual_assets WHERE content_id = $1 ORDER BY version DESC LIMIT 1',
    [contentId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}
