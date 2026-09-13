try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { draftSingleTopicPost } from './singleTopic.js';

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

function buildLlm(): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('Thought Leadership Head Agent')) {
      return JSON.stringify({
        hookOptions: ['A strong hook'],
        finalPost: 'HOOK\nCONTEXT\nINSIGHT\nMECHANISM\nEXAMPLE\nSO WHAT\nCLOSE',
        visualSuggestion: null,
        firstCommentOptional: null,
        factCheckStatus: 'This post is entirely the creator\'s opinion.',
        originalityStatus: 'No source material; wholly original.',
      });
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/linkedin single-topic mode (integration, real Postgres)', () => {
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

  it('drafts, QA-gates, persists and submits a single-topic post for review with no sources', async () => {
    const pkg = await draftSingleTopicPost({
      pool,
      llm: buildLlm(),
      topic: 'UPI adoption',
      angle: 'UPI growth is masking a merchant-fee problem',
      runId: 'test-run',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.mode).toBe('single_topic');
    expect(pkg.status).toBe('in_review');
    expect(pkg.sourceReferences).toEqual([]);
    expect(pkg.contentDnaVersion).toBe(dnaVersion);
    expect(pkg.approvalRequired).toBe(true);
    expect(pkg.publishAction).toBe('none');
    expect(pkg.finalPost).toContain('HOOK');
  });
});
