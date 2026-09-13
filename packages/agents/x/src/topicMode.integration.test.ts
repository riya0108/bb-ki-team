try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { loadCurrentDna } from '@bb/content-dna';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { draftXTopicPost, proposeXAngles } from './topicMode.js';

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

function buildLlm(mode: 'single' | 'thread'): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('generate three')) {
      return JSON.stringify({ angles: [{ angle: 'An angle', description: 'A description' }] });
    }
    if (!system.includes('X-native principles')) {
      // Every remaining call is one of qa-gate's rubric dimension checks.
      return JSON.stringify({ status: 'PASS', notes: 'ok' });
    }
    if (mode === 'single') {
      return JSON.stringify({
        mode: 'single',
        hookOptions: ['A strong hook'],
        finalCopy: 'A single sharp post about UPI.',
        threadPosts: null,
        factCheckStatus: 'Opinion.',
      });
    }
    return JSON.stringify({
      mode: 'thread',
      hookOptions: ['A strong hook'],
      finalCopy: 'Post 1 of the thread.',
      threadPosts: ['Post 1 of the thread.', 'Post 2 adds new evidence.', 'Post 3 closes it out.'],
      factCheckStatus: 'Opinion.',
    });
  });
}

describeIfDb('packages/agents/x single-post and thread modes (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let contentIdsThisTest: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, { version: Date.now() % 1_000_000, status: 'active', body: dnaBody });
    dnaVersion = dna.version;
  });

  afterEach(async () => {
    if (contentIdsThisTest.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [contentIdsThisTest]);
    }
    contentIdsThisTest = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  it('proposes angles for a topic', async () => {
    const dna = await loadCurrentDna(pool);
    const angles = await proposeXAngles('UPI adoption', dna, buildLlm('single'), 'test-run');
    expect(angles.length).toBeGreaterThan(0);
  });

  it('drafts a single post and submits it for review', async () => {
    const pkg = await draftXTopicPost({
      pool,
      llm: buildLlm('single'),
      topic: 'UPI adoption',
      angle: 'An angle',
      mode: 'single_topic',
      runId: 'test-run',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.mode).toBe('single');
    expect(pkg.status).toBe('in_review');
    expect(pkg.threadPosts).toBeNull();
    expect(pkg.contentDnaVersion).toBe(dnaVersion);
  });

  it('drafts a thread and persists all thread posts', async () => {
    const pkg = await draftXTopicPost({
      pool,
      llm: buildLlm('thread'),
      topic: 'UPI adoption',
      angle: 'An angle that needs a thread',
      mode: 'thread',
      runId: 'test-run',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.mode).toBe('thread');
    expect(pkg.threadPosts).toEqual([
      'Post 1 of the thread.',
      'Post 2 adds new evidence.',
      'Post 3 closes it out.',
    ]);

    const row = await pool.query<{ package: { threadPosts: string[] } }>(
      'SELECT package FROM content_items WHERE id = $1',
      [pkg.contentId],
    );
    expect(row.rows[0]?.package.threadPosts).toHaveLength(3);
  });
});
