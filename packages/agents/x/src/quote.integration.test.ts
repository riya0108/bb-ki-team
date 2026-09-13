try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runQuote } from './quote.js';

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

const unusedFetchTool: FetchTool = {
  fetchUrl(): Promise<FetchResult> {
    return Promise.reject(new Error('not used — this test supplies text directly'));
  },
  close(): Promise<void> {
    return Promise.resolve();
  },
};

function buildLlm(): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('X-native principles')) {
      return JSON.stringify({
        mode: 'single',
        hookOptions: ['A strong hook'],
        finalCopy: 'My disagreement with this post.',
        threadPosts: null,
        factCheckStatus: 'Opinion, reacting to the quoted post.',
      });
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/x quote mode (integration, real Postgres)', () => {
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

  it('drafts a single-shaped quote-commentary post and labels it mode "quote"', async () => {
    const pkg = await runQuote({
      pool,
      llm: buildLlm(),
      fetchTool: unusedFetchTool,
      source: { kind: 'text', label: 'https://x.com/someone/status/123', text: 'The original post being quoted.' },
      commentaryAngle: 'This take ignores who actually pays for the reward.',
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.mode).toBe('quote');
    expect(pkg.threadPosts).toBeNull();
    expect(pkg.status).toBe('in_review');
    expect(pkg.sourceReferences).toEqual(['https://x.com/someone/status/123']);
  });
});
