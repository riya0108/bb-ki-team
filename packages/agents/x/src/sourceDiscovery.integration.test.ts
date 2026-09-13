try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna, insertSource } from '@bb/db';
import type { Pool } from '@bb/db';
import { FetchToolError } from '@bb/mcp-client';
import type { FetchTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { NoAccessibleSourcesError, NoTrustedSourcesError } from './errors.js';
import { runSourceDiscovery } from './sourceDiscovery.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const noopLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const dnaBody = {
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: ['UPI'], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
};

function fakeFetchTool(textByUrl: Record<string, string>, unreachable: string[] = []): FetchTool {
  return {
    fetchUrl(url: string): Promise<FetchResult> {
      if (unreachable.includes(url)) throw new FetchToolError(url, 'simulated unreachable source');
      const text = textByUrl[url];
      if (text === undefined) throw new Error(`fakeFetchTool: no canned text for ${url}`);
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
    if (system.includes('trend/idea-discovery half')) {
      return JSON.stringify({ candidates });
    }
    if (system.includes('X-native principles')) {
      return JSON.stringify({
        mode: 'single',
        hookOptions: ['A strong hook'],
        finalCopy: 'Original take on the topic.',
        threadPosts: null,
        factCheckStatus: 'Sourced.',
      });
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/x source discovery (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let sourceIdsThisTest: string[] = [];
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
    if (sourceIdsThisTest.length > 0) {
      await pool.query('DELETE FROM sources WHERE id = ANY($1::uuid[])', [sourceIdsThisTest]);
    }
    sourceIdsThisTest = [];
    contentIdsThisTest = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  it('throws NoTrustedSourcesError when no active x sources are registered', async () => {
    await expect(
      runSourceDiscovery({ pool, llm: buildLlm([]), fetchTool: fakeFetchTool({}), logger: noopLogger, runId: 'r' }),
    ).rejects.toBeInstanceOf(NoTrustedSourcesError);
  });

  it('fetches trusted x sources, drafts, and submits for review', async () => {
    const url = `https://example.com/a-${Date.now()}`;
    const source = await insertSource(pool, { name: 'Source A', platform: 'x', url, tier: 'tier_1_primary' });
    sourceIdsThisTest.push(source.id);

    const llm = buildLlm([
      {
        sourceUrl: url,
        topic: 'UPI merchant fees',
        coreClaim: null,
        angle: 'Zero MDR is unsustainable',
        relevanceScore: 0.9,
        riskLevel: 'low',
      },
    ]);
    const fetchTool = fakeFetchTool({ [url]: 'UPI processed 15 billion transactions last quarter.' });

    const packages = await runSourceDiscovery({ pool, llm, fetchTool, logger: noopLogger, runId: 'r' });
    contentIdsThisTest.push(...packages.map((p) => p.contentId));

    expect(packages).toHaveLength(1);
    expect(packages[0]?.status).toBe('in_review');
    expect(packages[0]?.sourceReferences).toEqual([url]);
  });

  it('skips inaccessible sources rather than fabricating content', async () => {
    const badUrl = `https://example.com/bad-${Date.now()}`;
    const source = await insertSource(pool, { name: 'Bad', platform: 'x', url: badUrl, tier: 'tier_1_primary' });
    sourceIdsThisTest.push(source.id);

    const fetchTool = fakeFetchTool({}, [badUrl]);

    await expect(
      runSourceDiscovery({ pool, llm: buildLlm([]), fetchTool, logger: noopLogger, runId: 'r' }),
    ).rejects.toBeInstanceOf(NoAccessibleSourcesError);

    const row = await pool.query<{ status: string }>('SELECT status FROM sources WHERE id = $1', [source.id]);
    expect(row.rows[0]?.status).toBe('inaccessible');
  });
});
