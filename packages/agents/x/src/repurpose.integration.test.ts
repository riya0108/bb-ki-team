try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { FetchToolError } from '@bb/mcp-client';
import type { FetchTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { RepurposeSourceInaccessibleError } from './errors.js';
import { runRepurpose } from './repurpose.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const noopLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

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

function fakeFetchTool(text: string | null): FetchTool {
  return {
    fetchUrl(url: string): Promise<FetchResult> {
      if (text === null) throw new FetchToolError(url, 'simulated unreachable source');
      return Promise.resolve({
        sourceUrl: url,
        contentType: 'text/html',
        title: null,
        text,
        truncated: false,
        fetchedAt: new Date().toISOString(),
      });
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}

function buildLlm(candidates: unknown[]): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('research-lead half of Agent 02')) {
      return JSON.stringify({ candidates });
    }
    if (system.includes('X-native principles')) {
      return JSON.stringify({
        mode: 'single',
        hookOptions: ['A strong hook'],
        finalCopy: 'Original take on the article.',
        threadPosts: null,
        factCheckStatus: 'Sourced.',
      });
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/x repurpose mode (integration, real Postgres)', () => {
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

  it('drafts a post from a pasted transcript with no URL at all', async () => {
    const llm = buildLlm([
      {
        topic: 'Founder burnout',
        coreClaim: null,
        angle: 'Burnout is a planning failure, not a stamina failure',
        relevanceScore: 0.8,
        riskLevel: 'low',
      },
    ]);

    const packages = await runRepurpose({
      pool,
      llm,
      fetchTool: fakeFetchTool(null),
      source: { kind: 'text', label: 'Voice note, 2026-09-13', text: 'Transcribed voice note about burnout.' },
      logger: noopLogger,
      runId: 'r',
    });
    contentIdsThisTest.push(...packages.map((p) => p.contentId));

    expect(packages).toHaveLength(1);
    expect(packages[0]?.sourceReferences).toEqual(['Voice note, 2026-09-13']);
  });

  it('throws RepurposeSourceInaccessibleError when the supplied URL cannot be fetched', async () => {
    await expect(
      runRepurpose({
        pool,
        llm: buildLlm([]),
        fetchTool: fakeFetchTool(null),
        source: { kind: 'url', url: 'https://example.com/unreachable' },
        logger: noopLogger,
        runId: 'r',
      }),
    ).rejects.toBeInstanceOf(RepurposeSourceInaccessibleError);
  });
});
