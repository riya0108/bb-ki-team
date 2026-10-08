try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createPool, listLiveEditorialMemories } from '@bb/db';
import type { Pool } from '@bb/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MEMORY_SCOPE, recordEditorialSignal, setEditorialMemoryStatus } from './editorialMemory.js';
import { recordEditorialFeedback } from './feedback.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

describeIfDb('editorial memory (Postgres)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool(databaseUrl ?? '');
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM editorial_memories');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('confirms explicit feedback immediately and deduplicates repeats', async () => {
    const first = await recordEditorialSignal(pool, { subject: 'component:quiz', polarity: 'avoid', source: 'explicit_feedback', strength: 'explicit' });
    expect(first.action).toBe('created');
    expect(first.memory.status).toBe('CONFIRMED');
    const again = await recordEditorialSignal(pool, { subject: 'component:quiz', polarity: 'avoid', source: 'explicit_feedback', strength: 'explicit' });
    expect(again.action).toBe('reinforced');
    expect(again.memory.timesConfirmed).toBe(2);
    expect(await listLiveEditorialMemories(pool, MEMORY_SCOPE)).toHaveLength(1);
  });

  it('keeps observed signals INFERRED until they repeat three times', async () => {
    const signal = { subject: 'opening:question_led', polarity: 'prefer' as const, source: 'edit_diff' as const, strength: 'observed' as const };
    expect((await recordEditorialSignal(pool, signal)).memory.status).toBe('INFERRED');
    expect((await recordEditorialSignal(pool, signal)).memory.status).toBe('INFERRED');
    const third = await recordEditorialSignal(pool, signal);
    expect(third.memory.status).toBe('CONFIRMED');
    expect(third.memory.timesConfirmed).toBe(3);
  });

  it('lets explicit opposite feedback supersede, but an observed one only weakens a confirmed memory', async () => {
    const confirmed = await recordEditorialSignal(pool, { subject: 'component:table', polarity: 'prefer', source: 'explicit_feedback', strength: 'explicit' });
    const observed = await recordEditorialSignal(pool, { subject: 'component:table', polarity: 'avoid', source: 'edit_diff', strength: 'observed' });
    expect(observed.action).toBe('weakened_opposite');
    expect(observed.memory.memoryId).toBe(confirmed.memory.memoryId);
    expect(observed.memory.timesRejected).toBe(1);

    const explicit = await recordEditorialSignal(pool, { subject: 'component:table', polarity: 'avoid', source: 'explicit_feedback', strength: 'explicit' });
    expect(explicit.action).toBe('superseded');
    const live = await listLiveEditorialMemories(pool, MEMORY_SCOPE);
    expect(live.map((m) => `${m.subject}:${m.polarity}`)).toEqual(['component:table:avoid']);
    const old = await pool.query<{ superseded_by: string }>('SELECT superseded_by FROM editorial_memories WHERE id = $1', [confirmed.memory.memoryId]);
    expect(old.rows[0]?.superseded_by).toBe(explicit.memory.memoryId);
  });

  it('never lets an observed pattern resurrect a memory the editor rejected', async () => {
    const created = await recordEditorialSignal(pool, { subject: 'component:poll', polarity: 'prefer', source: 'approval', strength: 'observed' });
    await setEditorialMemoryStatus(pool, created.memory.memoryId, 'reject');
    for (let i = 0; i < 4; i += 1) {
      const outcome = await recordEditorialSignal(pool, { subject: 'component:poll', polarity: 'prefer', source: 'approval', strength: 'observed' });
      expect(outcome.action).toBe('kept_rejected');
      expect(outcome.memory.status).toBe('REJECTED');
    }
  });

  it('stores unclassifiable explicit feedback as a custom memory only when asked to', async () => {
    expect(await recordEditorialFeedback({ db: pool, feedback: 'Use more Mumbai examples', source: 'explicit_feedback', strength: 'explicit' })).toEqual([]);
    const kept = await recordEditorialFeedback({ db: pool, feedback: 'Use more Mumbai examples', source: 'explicit_feedback', strength: 'explicit', keepUnclassified: true });
    expect(kept[0]?.memory.subject).toBe('custom:use_more_mumbai_examples');
    expect(kept[0]?.memory.statement).toBe('Use more Mumbai examples');
  });
});
