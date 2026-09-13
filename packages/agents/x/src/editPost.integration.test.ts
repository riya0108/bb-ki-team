try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { ContentItemNotFoundError, createContentItem, submitForReview } from '@bb/workflows';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { reviseXPost } from './editPost.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const dnaBody = {
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: [], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
};

function buildLlm(
  revised: { mode: 'single' | 'thread'; finalCopy: string; threadPosts: string[] | null },
  classification: { isVoiceLevelInstruction: boolean; summary: string; proposedChange: unknown } = {
    isVoiceLevelInstruction: false,
    summary: 'one-off',
    proposedChange: null,
  },
): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('Edit mode')) {
      return JSON.stringify({
        mode: revised.mode,
        hookOptions: ['A punchier hook'],
        finalCopy: revised.finalCopy,
        threadPosts: revised.threadPosts,
        factCheckStatus: 'Unchanged.',
      });
    }
    if (system.includes('classify an edit instruction')) {
      return JSON.stringify(classification);
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/x edit mode (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let contentIdsThisTest: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, { version: Date.now() % 1_000_000, status: 'active', body: dnaBody });
    dnaVersion = dna.version;
  });

  afterEach(async () => {
    await pool.query('DELETE FROM learning_events WHERE content_id = ANY($1::uuid[])', [contentIdsThisTest]);
    if (contentIdsThisTest.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [contentIdsThisTest]);
    }
    contentIdsThisTest = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  it('revises a single post, bumps its version, and preserves the single shape', async () => {
    const item = await createContentItem(pool, {
      platform: 'x',
      createdByAgent: 'agent-02-x',
      mode: 'single_topic',
      topic: 'UPI adoption',
      angle: 'An angle',
      contentDnaVersion: dnaVersion,
      text: 'Original post text.',
      package: { mode: 'single', hookOptions: ['hook'], threadPosts: null },
    });
    contentIdsThisTest.push(item.id);
    await submitForReview(pool, item.id);

    const { package: pkg, learningEvent } = await reviseXPost({
      pool,
      llm: buildLlm({ mode: 'single', finalCopy: 'Punchier post text.', threadPosts: null }),
      contentId: item.id,
      instruction: 'Make the hook punchier',
      runId: 'r',
    });

    expect(pkg.finalCopy).toBe('Punchier post text.');
    expect(pkg.mode).toBe('single');
    expect(pkg.status).toBe('in_review');
    expect(learningEvent).toBeNull();

    const row = await pool.query<{ current_version: number }>(
      'SELECT current_version FROM content_items WHERE id = $1',
      [item.id],
    );
    expect(row.rows[0]?.current_version).toBe(2);
  });

  it('updates the persisted package when a thread is re-edited', async () => {
    const item = await createContentItem(pool, {
      platform: 'x',
      createdByAgent: 'agent-02-x',
      mode: 'thread',
      topic: 'UPI adoption',
      angle: 'An angle',
      contentDnaVersion: dnaVersion,
      text: 'Post 1.',
      package: { mode: 'thread', hookOptions: ['hook'], threadPosts: ['Post 1.', 'Post 2.'] },
    });
    contentIdsThisTest.push(item.id);
    await submitForReview(pool, item.id);

    const { package: pkg } = await reviseXPost({
      pool,
      llm: buildLlm({ mode: 'thread', finalCopy: 'Post 1, revised.', threadPosts: ['Post 1, revised.', 'Post 2.', 'Post 3, new.'] }),
      contentId: item.id,
      instruction: 'Add a third post with a concrete example',
      runId: 'r',
    });

    expect(pkg.threadPosts).toEqual(['Post 1, revised.', 'Post 2.', 'Post 3, new.']);

    const row = await pool.query<{ package: { threadPosts: string[] } }>(
      'SELECT package FROM content_items WHERE id = $1',
      [item.id],
    );
    expect(row.rows[0]?.package.threadPosts).toEqual(['Post 1, revised.', 'Post 2.', 'Post 3, new.']);
  });

  it('records a learning event for a voice-level instruction, without touching Content DNA', async () => {
    const item = await createContentItem(pool, {
      platform: 'x',
      createdByAgent: 'agent-02-x',
      mode: 'single_topic',
      topic: 'UPI adoption',
      angle: 'An angle',
      contentDnaVersion: dnaVersion,
      text: 'Original post text.',
      package: { mode: 'single', hookOptions: ['hook'], threadPosts: null },
    });
    contentIdsThisTest.push(item.id);
    await submitForReview(pool, item.id);

    const { learningEvent } = await reviseXPost({
      pool,
      llm: buildLlm(
        { mode: 'single', finalCopy: 'Revised without exclamation marks.', threadPosts: null },
        {
          isVoiceLevelInstruction: true,
          summary: 'Creator never wants exclamation marks.',
          proposedChange: { voice: { forbiddenPhrases: ['!'] } },
        },
      ),
      contentId: item.id,
      instruction: 'Never use exclamation marks',
      runId: 'r',
    });

    expect(learningEvent).not.toBeNull();
    expect(learningEvent?.strength).toBe('very_strong');
    expect(learningEvent?.appliedToDna).toBe(false);

    const dnaRows = await pool.query<{ count: string }>("SELECT COUNT(*) FROM content_dna WHERE status = 'active'");
    expect(dnaRows.rows[0]?.count).toBe('1');
  });

  it('throws ContentItemNotFoundError for an unknown content id', async () => {
    await expect(
      reviseXPost({
        pool,
        llm: buildLlm({ mode: 'single', finalCopy: 'irrelevant', threadPosts: null }),
        contentId: '00000000-0000-0000-0000-000000000099',
        instruction: 'anything',
        runId: 'r',
      }),
    ).rejects.toBeInstanceOf(ContentItemNotFoundError);
  });
});
