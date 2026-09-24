import type { VisualReferenceKind } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

// No assetUrl here deliberately — a signed URL expires, and this row can be read
// long after it was uploaded (that's the whole point of a reusable reference
// library), so the API layer always re-signs assetPath fresh on each read via
// ImageGenTool.signAsset rather than trusting a URL persisted at upload time.
export interface VisualReferenceAssetRecord {
  id: string;
  platform: string;
  kind: VisualReferenceKind;
  label: string | null;
  assetPath: string;
  mimeType: string;
  active: boolean;
  createdAt: string;
}

interface VisualReferenceAssetRow {
  id: string;
  platform: string;
  kind: VisualReferenceKind;
  label: string | null;
  asset_path: string;
  mime_type: string;
  active: boolean;
  created_at: Date;
}

function mapRow(row: VisualReferenceAssetRow): VisualReferenceAssetRecord {
  return {
    id: row.id,
    platform: row.platform,
    kind: row.kind,
    label: row.label,
    assetPath: row.asset_path,
    mimeType: row.mime_type,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateVisualReferenceAssetInput {
  platform: string;
  kind: VisualReferenceKind;
  label: string | null;
  assetPath: string;
  mimeType: string;
}

export async function createReferenceAsset(
  db: Queryable,
  input: CreateVisualReferenceAssetInput,
): Promise<VisualReferenceAssetRecord> {
  const inserted = await db.query<VisualReferenceAssetRow>(
    `INSERT INTO visual_reference_assets (platform, kind, label, asset_path, mime_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.platform, input.kind, input.label, input.assetPath, input.mimeType],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error('createReferenceAsset: insert returned no row');
  return mapRow(row);
}

// Active-only by default — deactivated references stay in the table for audit
// (CLAUDE.md: important decisions must be auditable) rather than being deleted.
export async function listReferenceAssets(
  db: Queryable,
  platform: string,
  kind?: VisualReferenceKind,
): Promise<VisualReferenceAssetRecord[]> {
  const result = kind
    ? await db.query<VisualReferenceAssetRow>(
        `SELECT * FROM visual_reference_assets
         WHERE platform = $1 AND kind = $2 AND active
         ORDER BY created_at ASC`,
        [platform, kind],
      )
    : await db.query<VisualReferenceAssetRow>(
        `SELECT * FROM visual_reference_assets
         WHERE platform = $1 AND active
         ORDER BY created_at ASC`,
        [platform],
      );
  return result.rows.map(mapRow);
}

export async function deactivateReferenceAsset(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE visual_reference_assets SET active = false WHERE id = $1', [id]);
}
