import type {
  ContentDnaBody,
  ContentDnaRecord,
} from '@bb/shared-types';
import { ContentDnaRecordSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface ContentDnaRow {
  id: string;
  version: number;
  status: string;
  identity: unknown;
  topics: unknown;
  opinions: unknown;
  voice: unknown;
  storytelling: unknown;
  personal_context: unknown;
  platform_preferences: unknown;
  learning: unknown;
  created_at: Date;
  confirmed_at: Date | null;
  confirmed_by: string | null;
}

function mapRow(row: ContentDnaRow): ContentDnaRecord {
  return ContentDnaRecordSchema.parse({
    id: row.id,
    version: row.version,
    status: row.status,
    identity: row.identity,
    topics: row.topics,
    opinions: row.opinions,
    voice: row.voice,
    storytelling: row.storytelling,
    personalContext: row.personal_context,
    platformPreferences: row.platform_preferences,
    learning: row.learning,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    confirmedBy: row.confirmed_by,
  });
}

export async function getActiveContentDna(db: Queryable): Promise<ContentDnaRecord | null> {
  const result = await db.query<ContentDnaRow>("SELECT * FROM content_dna WHERE status = 'active' LIMIT 1");
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function getMaxDnaVersion(db: Queryable): Promise<number> {
  const result = await db.query<{ max: number | null }>('SELECT MAX(version) AS max FROM content_dna');
  return result.rows[0]?.max ?? 0;
}

export async function supersedeActiveContentDna(db: Queryable): Promise<void> {
  await db.query("UPDATE content_dna SET status = 'superseded' WHERE status = 'active'");
}

export async function insertContentDna(
  db: Queryable,
  input: { version: number; status: 'draft' | 'active'; body: ContentDnaBody; confirmedBy?: string },
): Promise<ContentDnaRecord> {
  const confirmedAt = input.status === 'active' ? new Date() : null;
  const result = await db.query<ContentDnaRow>(
    `INSERT INTO content_dna
       (version, status, identity, topics, opinions, voice, storytelling, personal_context, platform_preferences, learning, confirmed_at, confirmed_by)
     VALUES ($1, $2::dna_status, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.version,
      input.status,
      JSON.stringify(input.body.identity),
      JSON.stringify(input.body.topics),
      JSON.stringify(input.body.opinions),
      JSON.stringify(input.body.voice),
      JSON.stringify(input.body.storytelling),
      JSON.stringify(input.body.personalContext),
      JSON.stringify(input.body.platformPreferences),
      JSON.stringify(input.body.learning),
      confirmedAt,
      input.confirmedBy ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertContentDna: insert returned no row');
  return mapRow(row);
}
