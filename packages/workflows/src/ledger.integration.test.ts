try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  ContentItemNotFoundError,
  StaleApprovalVersionError,
  addRevision,
  createContentItem,
  getContentItem,
  recordApproval,
  reject,
  requestChanges,
  submitForReview,
} from './ledger.js';
import { IllegalTransitionError } from './stateMachine.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const dnaBody = {
  identity: { role: 'Founder', expertise: [], audiencePrimary: 'x' },
  topics: { primary: [], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
};

describeIfDb('packages/workflows ledger (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  const createdContentIds: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    // Unique version per test run so repeated runs don't collide on the unique constraint.
    dnaVersion = Date.now() % 1_000_000;
    const dna = await insertContentDna(pool, { version: dnaVersion, status: 'active', body: dnaBody });
    dnaVersion = dna.version;
  });

  afterEach(async () => {
    if (createdContentIds.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [createdContentIds]);
      createdContentIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  async function seedItem(): Promise<string> {
    const item = await createContentItem(pool, {
      platform: 'linkedin',
      createdByAgent: 'agent-linkedin',
      mode: 'single_topic',
      topic: 'AI regulation',
      contentDnaVersion: dnaVersion,
      text: 'first draft',
    });
    createdContentIds.push(item.id);
    return item.id;
  }

  it('takes an item from draft through review to approval', async () => {
    const id = await seedItem();
    const inReview = await submitForReview(pool, id);
    expect(inReview.status).toBe('in_review');

    const approved = await recordApproval(pool, id, inReview.currentVersion, 'riya');
    expect(approved.status).toBe('approved');
    expect(approved.approvedVersion).toBe(inReview.currentVersion);
    expect(approved.approvedBy).toBe('riya');
  });

  it('refuses to approve a stale version', async () => {
    const id = await seedItem();
    await submitForReview(pool, id);
    await expect(recordApproval(pool, id, 999, 'riya')).rejects.toBeInstanceOf(StaleApprovalVersionError);
  });

  it('refuses to approve outside of in_review', async () => {
    const id = await seedItem();
    // still in 'draft', never submitted for review
    await expect(recordApproval(pool, id, 1, 'riya')).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('THE critical path: editing an approved item invalidates the approval and returns it to review', async () => {
    const id = await seedItem();
    const inReview = await submitForReview(pool, id);
    const approved = await recordApproval(pool, id, inReview.currentVersion, 'riya');
    expect(approved.status).toBe('approved');

    const { item, revision } = await addRevision(pool, id, {
      changeType: 'user_edit',
      newText: 'edited after approval',
      changedBy: 'user',
    });

    expect(item.status).toBe('in_review');
    expect(item.approvedVersion).toBeNull();
    expect(item.approvedBy).toBeNull();
    expect(item.currentText).toBe('edited after approval');
    expect(item.currentVersion).toBe(approved.currentVersion + 1);
    expect(revision.approvalInvalidated).toBe(true);

    const approvalRow = await pool.query<{ invalidated_at: Date | null }>(
      'SELECT invalidated_at FROM approvals WHERE content_id = $1 ORDER BY approved_at DESC LIMIT 1',
      [id],
    );
    expect(approvalRow.rows[0]?.invalidated_at).not.toBeNull();

    // The freshly-invalidated item can be approved again at its new version.
    const reApproved = await recordApproval(pool, id, item.currentVersion, 'riya');
    expect(reApproved.status).toBe('approved');
    expect(reApproved.approvedVersion).toBe(item.currentVersion);
  });

  it('requestChanges and reject transition status correctly', async () => {
    const id = await seedItem();
    await submitForReview(pool, id);

    const changesRequested = await requestChanges(pool, id, 'make it punchier');
    expect(changesRequested.status).toBe('changes_requested');

    const rejected = await reject(pool, id, 'not on brand');
    expect(rejected.status).toBe('rejected');
  });

  it('getContentItem returns null for an unknown id, and ledger functions throw ContentItemNotFoundError', async () => {
    const unknownId = '11111111-1111-4111-8111-111111111111';
    expect(await getContentItem(pool, unknownId)).toBeNull();
    await expect(submitForReview(pool, unknownId)).rejects.toBeInstanceOf(ContentItemNotFoundError);
  });
});
