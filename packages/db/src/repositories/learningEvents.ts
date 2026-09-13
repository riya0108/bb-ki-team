import type { LearningEvent, NewLearningEventInput } from '@bb/shared-types';
import { LearningEventSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface LearningEventRow {
  id: string;
  created_at: Date;
  content_id: string | null;
  source: string;
  observation: string;
  strength: string;
  confidence: string | null;
  proposed_change: unknown;
  confirmed_by_user: boolean | null;
  applied_to_dna: boolean;
  dna_version: number | null;
}

function mapRow(row: LearningEventRow): LearningEvent {
  return LearningEventSchema.parse({
    id: row.id,
    createdAt: row.created_at.toISOString(),
    contentId: row.content_id,
    source: row.source,
    observation: row.observation,
    strength: row.strength,
    confidence: row.confidence !== null ? Number(row.confidence) : null,
    proposedChange: row.proposed_change,
    confirmedByUser: row.confirmed_by_user,
    appliedToDna: row.applied_to_dna,
    dnaVersion: row.dna_version,
  });
}

export async function insertLearningEvent(
  db: Queryable,
  input: NewLearningEventInput & { strength: LearningEvent['strength'] },
): Promise<LearningEvent> {
  const result = await db.query<LearningEventRow>(
    `INSERT INTO learning_events (content_id, source, observation, strength, confidence, proposed_change)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.contentId ?? null,
      input.source,
      input.observation,
      input.strength,
      input.confidence ?? null,
      input.proposedChange ? JSON.stringify(input.proposedChange) : null,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertLearningEvent: insert returned no row');
  return mapRow(row);
}

export async function getLearningEventById(db: Queryable, id: string): Promise<LearningEvent | null> {
  const result = await db.query<LearningEventRow>('SELECT * FROM learning_events WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function markLearningEventApplied(db: Queryable, id: string, dnaVersion: number): Promise<void> {
  await db.query(
    'UPDATE learning_events SET applied_to_dna = true, confirmed_by_user = true, dna_version = $2 WHERE id = $1',
    [id, dnaVersion],
  );
}

// Surfaces events a human still needs to act on: proposed a DNA change, not yet
// applied, and not already explicitly rejected (confirmed_by_user = false).
export async function listPendingLearningEvents(db: Queryable): Promise<LearningEvent[]> {
  const result = await db.query<LearningEventRow>(
    `SELECT * FROM learning_events
     WHERE applied_to_dna = false AND confirmed_by_user IS NOT false
     ORDER BY created_at DESC`,
  );
  return result.rows.map(mapRow);
}

export async function rejectLearningEvent(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE learning_events SET confirmed_by_user = false WHERE id = $1', [id]);
}
