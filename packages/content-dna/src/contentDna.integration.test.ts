try {
  process.loadEnvFile();
} catch {
  // no .env file present — the describeIfDb guard below skips these tests.
}

import { createPool } from '@bb/db';
import type { Pool } from '@bb/db';
import type { ContentDnaDraft } from '@bb/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WeakLearningSignalError } from './errors.js';
import { confirmDnaChange, recordLearningEvent } from './learningEvents.js';
import { confirmDna, loadCurrentDna } from './versioning.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const initialDraft: ContentDnaDraft = {
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  pendingQuestions: [],
};

describeIfDb('packages/content-dna versioning + learning events (integration, real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    // Clean slate — this suite is the only thing in Phase 1 that commits real
    // content_dna rows (packages/db's own integration tests use rollback), but be
    // defensive in case a previous failed run left rows behind.
    await pool.query('DELETE FROM learning_events');
    await pool.query('DELETE FROM content_dna');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM learning_events');
    await pool.query('DELETE FROM content_dna');
    await pool.end();
  });

  it('confirms an initial version as active and loads it back', async () => {
    const created = await confirmDna(pool, initialDraft, 'riya');
    expect(created.version).toBe(1);
    expect(created.status).toBe('active');

    const loaded = await loadCurrentDna(pool);
    expect(loaded.id).toBe(created.id);
    expect(loaded.identity.role).toBe('Founder');
  });

  it('supersedes the previous version when a new one is confirmed, keeping exactly one active row', async () => {
    const second = await confirmDna(
      pool,
      { ...initialDraft, voice: { tone: 'more direct', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] } },
      'riya',
    );
    expect(second.version).toBe(2);
    expect(second.status).toBe('active');

    const activeRows = await pool.query<{ count: string }>(
      "SELECT COUNT(*) FROM content_dna WHERE status = 'active'",
    );
    expect(activeRows.rows[0]?.count).toBe('1');

    const supersededRows = await pool.query<{ version: number }>(
      "SELECT version FROM content_dna WHERE status = 'superseded'",
    );
    expect(supersededRows.rows.map((r) => r.version)).toEqual([1]);
  });

  it('applies a strong learning event as a brand-new DNA version and marks it applied', async () => {
    const before = await loadCurrentDna(pool);
    const event = await recordLearningEvent(pool, {
      source: 'user_instruction',
      observation: 'always mention UPI when discussing payments',
      strength: 'very_strong',
      proposedChange: { voice: { tone: 'direct and specific' } },
    });

    const updated = await confirmDnaChange(pool, event.id, 'riya');
    expect(updated.version).toBe(before.version + 1);
    expect(updated.voice.tone).toBe('direct and specific');
    // Untouched sections should carry over from the previous version, not reset.
    expect(updated.identity.role).toBe('Founder');
  });

  it('refuses to apply a weak learning event to the DNA', async () => {
    const event = await recordLearningEvent(pool, {
      source: 'user_edit',
      observation: 'fixed a typo once',
      strength: 'weak',
    });

    await expect(confirmDnaChange(pool, event.id, 'riya')).rejects.toBeInstanceOf(WeakLearningSignalError);
  });
});
