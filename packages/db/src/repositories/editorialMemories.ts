import type { EditorialMemory, MemoryCategory, MemorySource, MemoryStatus } from '@bb/shared-types';
import { EditorialMemorySchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

// Storage primitives for editorial_memories (migration 0020). Reinforcement, decay
// and supersession rules live in the Blog agent's memory module — this file only
// reads and writes rows.

interface EditorialMemoryRow {
  id: string;
  scope: string;
  category: MemoryCategory;
  subject: string;
  polarity: 'prefer' | 'avoid';
  statement: string;
  confidence: string;
  source: string;
  status: MemoryStatus;
  times_confirmed: number;
  times_rejected: number;
  valid_until: Date | null;
  superseded_by: string | null;
  evidence: unknown;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
}

function mapRow(row: EditorialMemoryRow): EditorialMemory {
  return EditorialMemorySchema.parse({
    memoryId: row.id,
    category: row.category,
    subject: row.subject,
    polarity: row.polarity,
    statement: row.statement,
    confidence: Number(row.confidence),
    source: row.source,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    timesConfirmed: row.times_confirmed,
    timesRejected: row.times_rejected,
    validUntil: row.valid_until?.toISOString() ?? null,
    supersededById: row.superseded_by,
    evidence: row.evidence,
  });
}

export interface NewEditorialMemoryInput {
  scope: string;
  category: MemoryCategory;
  subject: string;
  polarity: 'prefer' | 'avoid';
  statement: string;
  confidence: number;
  source: MemorySource;
  status: MemoryStatus;
  timesConfirmed: number;
  validUntil: string | null;
  evidence: EditorialMemory['evidence'];
}

export async function insertEditorialMemory(db: Queryable, input: NewEditorialMemoryInput): Promise<EditorialMemory> {
  const result = await db.query<EditorialMemoryRow>(
    `INSERT INTO editorial_memories
       (scope, category, subject, polarity, statement, confidence, source, status, times_confirmed, valid_until, evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.scope,
      input.category,
      input.subject,
      input.polarity,
      input.statement,
      input.confidence,
      input.source,
      input.status,
      input.timesConfirmed,
      input.validUntil,
      JSON.stringify(input.evidence),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertEditorialMemory: insert returned no row');
  return mapRow(row);
}

export interface EditorialMemoryPatch {
  statement?: string;
  confidence?: number;
  status?: MemoryStatus;
  timesConfirmed?: number;
  timesRejected?: number;
  validUntil?: string | null;
  supersededById?: string | null;
  evidence?: EditorialMemory['evidence'];
}

export async function updateEditorialMemory(db: Queryable, id: string, patch: EditorialMemoryPatch): Promise<EditorialMemory> {
  const result = await db.query<EditorialMemoryRow>(
    `UPDATE editorial_memories SET
       statement = COALESCE($2, statement),
       confidence = COALESCE($3, confidence),
       status = COALESCE($4::editorial_memory_status, status),
       times_confirmed = COALESCE($5, times_confirmed),
       times_rejected = COALESCE($6, times_rejected),
       valid_until = CASE WHEN $7::boolean THEN $8::timestamptz ELSE valid_until END,
       superseded_by = CASE WHEN $9::boolean THEN $10::uuid ELSE superseded_by END,
       evidence = COALESCE($11::jsonb, evidence),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      patch.statement ?? null,
      patch.confidence ?? null,
      patch.status ?? null,
      patch.timesConfirmed ?? null,
      patch.timesRejected ?? null,
      patch.validUntil !== undefined,
      patch.validUntil ?? null,
      patch.supersededById !== undefined,
      patch.supersededById ?? null,
      patch.evidence ? JSON.stringify(patch.evidence) : null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`updateEditorialMemory: no memory ${id}`);
  return mapRow(row);
}

export async function getEditorialMemory(db: Queryable, id: string): Promise<EditorialMemory | null> {
  const result = await db.query<EditorialMemoryRow>('SELECT * FROM editorial_memories WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

// The live (non-superseded) memory for a subject, in either polarity.
export async function findLiveEditorialMemories(db: Queryable, scope: string, subject: string): Promise<EditorialMemory[]> {
  const result = await db.query<EditorialMemoryRow>(
    `SELECT * FROM editorial_memories
     WHERE scope = $1 AND subject = $2 AND superseded_by IS NULL`,
    [scope, subject],
  );
  return result.rows.map(mapRow);
}

export async function listLiveEditorialMemories(db: Queryable, scope: string): Promise<EditorialMemory[]> {
  const result = await db.query<EditorialMemoryRow>(
    `SELECT * FROM editorial_memories
     WHERE scope = $1 AND superseded_by IS NULL
     ORDER BY (status = 'CONFIRMED') DESC, confidence DESC, updated_at DESC`,
    [scope],
  );
  return result.rows.map(mapRow);
}

export async function markEditorialMemoriesUsed(db: Queryable, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query('UPDATE editorial_memories SET last_used_at = now() WHERE id = ANY($1::uuid[])', [ids]);
}
