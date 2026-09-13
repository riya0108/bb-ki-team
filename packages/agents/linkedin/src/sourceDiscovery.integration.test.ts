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
      if (unreachable.includes(url)) {
        throw new FetchToolError(url, 'simulated unreachable source');
      }
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
    if (system.includes('research-lead half of Agent 01')) {
      return JSON.stringify({ candidates });
    }
    if (system.includes('Thought Leadership Head Agent')) {
      return JSON.stringify({
        hookOptions: ['A strong hook'],
        finalPost: `Original take on ${input.messages[0]?.content.split('\n')[0] ?? 'topic'}`,
        visualSuggestion: null,
        firstCommentOptional: null,
        factCheckStatus: 'Volume figure is sourced; rest is interpretation.',
        originalityStatus: 'Adds a disagreement the source does not make.',
      });
    }
    // Every remaining call is one of qa-gate's rubric dimension checks.
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/linkedin source discovery (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  // Reset before each test — every test cleans up its own rows in afterEach, so
  // active-sources state never leaks between tests (listSources sees ALL active rows).
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

  it('throws NoTrustedSourcesError when no active linkedin sources are registered', async () => {
    await expect(
      runSourceDiscovery({
        pool,
        llm: buildLlm([]),
        fetchTool: fakeFetchTool({}),
        logger: noopLogger,
        runId: 'test-run-empty',
      }),
    ).rejects.toBeInstanceOf(NoTrustedSourcesError);
  });

  it('fetches trusted sources, selects two distinct topics, drafts and submits both for review', async () => {
    const urlA = `https://example.com/a-${Date.now()}`;
    const urlB = `https://example.com/b-${Date.now()}`;
    const sourceA = await insertSource(pool, { name: 'Source A', platform: 'linkedin', url: urlA, tier: 'tier_1_primary' });
    const sourceB = await insertSource(pool, { name: 'Source B', platform: 'linkedin', url: urlB, tier: 'tier_1_primary' });
    sourceIdsThisTest.push(sourceA.id, sourceB.id);

    const llm = buildLlm([
      {
        sourceUrl: urlA,
        topic: 'UPI merchant fees',
        coreClaim: 'UPI processed 15 billion transactions last quarter',
        angle: 'Zero MDR is unsustainable for small merchants',
        relevanceScore: 0.9,
        riskLevel: 'low',
      },
      {
        sourceUrl: urlB,
        topic: 'Startup layoffs',
        coreClaim: null,
        angle: 'Layoffs are a signal of overhiring, not demand collapse',
        relevanceScore: 0.7,
        riskLevel: 'low',
      },
    ]);

    const fetchTool = fakeFetchTool({
      [urlA]: 'UPI processed 15 billion transactions last quarter, per NPCI data.',
      [urlB]: 'Several startups announced layoffs this month citing efficiency.',
    });

    const packages = await runSourceDiscovery({ pool, llm, fetchTool, logger: noopLogger, runId: 'test-run' });
    contentIdsThisTest.push(...packages.map((p) => p.contentId));

    expect(packages).toHaveLength(2);
    const topics = packages.map((p) => p.topic).sort();
    expect(topics).toEqual(['Startup layoffs', 'UPI merchant fees']);
    for (const pkg of packages) {
      expect(pkg.status).toBe('in_review');
      expect(pkg.approvalRequired).toBe(true);
      expect(pkg.publishAction).toBe('none');
      expect(pkg.contentDnaVersion).toBe(dnaVersion);
      expect(pkg.sourceReferences).toHaveLength(1);
    }
  });

  it('skips inaccessible sources and marks them inaccessible rather than fabricating content', async () => {
    const goodUrl = `https://example.com/good-${Date.now()}`;
    const badUrl = `https://example.com/bad-${Date.now()}`;
    const goodSource = await insertSource(pool, { name: 'Good', platform: 'linkedin', url: goodUrl, tier: 'tier_1_primary' });
    const badSource = await insertSource(pool, { name: 'Bad', platform: 'linkedin', url: badUrl, tier: 'tier_1_primary' });
    sourceIdsThisTest.push(goodSource.id, badSource.id);

    const fetchTool = fakeFetchTool({ [goodUrl]: 'Some fetchable content about fintech regulation.' }, [badUrl]);

    // Only one accessible source, and this LLM only proposes one candidate from it —
    // not enough for a 2-topic batch, so this should fail with insufficient topics,
    // proving the bad source was skipped rather than silently fabricated content for.
    const llm = buildLlm([
      {
        sourceUrl: goodUrl,
        topic: 'Fintech regulation',
        coreClaim: null,
        angle: 'An angle',
        relevanceScore: 0.6,
        riskLevel: 'low',
      },
    ]);

    await expect(
      runSourceDiscovery({ pool, llm, fetchTool, logger: noopLogger, runId: 'test-run-partial' }),
    ).rejects.toThrow();

    const badRow = await pool.query<{ status: string }>('SELECT status FROM sources WHERE id = $1', [badSource.id]);
    expect(badRow.rows[0]?.status).toBe('inaccessible');
  });

  it('throws NoAccessibleSourcesError when every registered source is unreachable', async () => {
    const url = `https://example.com/unreachable-${Date.now()}`;
    const source = await insertSource(pool, { name: 'Unreachable', platform: 'linkedin', url, tier: 'tier_1_primary' });
    sourceIdsThisTest.push(source.id);

    const fetchTool = fakeFetchTool({}, [url]);

    await expect(
      runSourceDiscovery({ pool, llm: buildLlm([]), fetchTool, logger: noopLogger, runId: 'test-run-unreachable' }),
    ).rejects.toBeInstanceOf(NoAccessibleSourcesError);
  });
});
