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
    if (system.includes('research-lead half of Agent 01')) {
      return JSON.stringify({ candidates });
    }
    if (system.includes('Thought Leadership Head Agent')) {
      return JSON.stringify({
        hookOptions: ['A strong hook'],
        finalPost: 'HOOK\nCONTEXT\nINSIGHT\nMECHANISM\nEXAMPLE\nSO WHAT\nCLOSE',
        visualSuggestion: null,
        firstCommentOptional: null,
        factCheckStatus: 'Sourced from the supplied article.',
        originalityStatus: 'Adds the creator\'s disagreement with the article.',
      });
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/linkedin repurpose mode (integration, real Postgres)', () => {
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

  it('drafts one post from a user-supplied article by default', async () => {
    const sourceUrl = `https://example.com/article-${Date.now()}`;
    const llm = buildLlm([
      {
        topic: 'Fintech regulation',
        coreClaim: 'The regulator proposed a new cap on merchant fees',
        angle: 'This favors incumbents over new entrants',
        relevanceScore: 0.8,
        riskLevel: 'low',
      },
    ]);

    const packages = await runRepurpose({
      pool,
      llm,
      fetchTool: fakeFetchTool('The regulator proposed a new cap on merchant fees this week.'),
      source: { kind: 'url', url: sourceUrl },
      mode: 'repurpose',
      logger: noopLogger,
      runId: 'test-run',
    });
    contentIdsThisTest.push(...packages.map((p) => p.contentId));

    expect(packages).toHaveLength(1);
    expect(packages[0]?.mode).toBe('repurpose');
    expect(packages[0]?.sourceReferences).toEqual([sourceUrl]);
    expect(packages[0]?.status).toBe('in_review');
  });

  it('drafts from a pasted transcript with no URL at all', async () => {
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
      mode: 'voice_note',
      logger: noopLogger,
      runId: 'test-run',
    });
    contentIdsThisTest.push(...packages.map((p) => p.contentId));

    expect(packages).toHaveLength(1);
    expect(packages[0]?.sourceReferences).toEqual(['Voice note, 2026-09-13']);
  });

  it('drafts multiple distinct posts when postCount > 1', async () => {
    const sourceUrl = `https://example.com/article-multi-${Date.now()}`;
    const llm = buildLlm([
      { topic: 'Fee caps', coreClaim: null, angle: 'Angle A', relevanceScore: 0.9, riskLevel: 'low' },
      { topic: 'Regulatory capture', coreClaim: null, angle: 'Angle B', relevanceScore: 0.7, riskLevel: 'low' },
    ]);

    const packages = await runRepurpose({
      pool,
      llm,
      fetchTool: fakeFetchTool('A long article about fee caps and regulatory capture.'),
      source: { kind: 'url', url: sourceUrl },
      mode: 'repurpose',
      logger: noopLogger,
      runId: 'test-run',
      postCount: 2,
    });
    contentIdsThisTest.push(...packages.map((p) => p.contentId));

    expect(packages).toHaveLength(2);
    const topics = packages.map((p) => p.topic).sort();
    expect(topics).toEqual(['Fee caps', 'Regulatory capture']);
  });

  it('throws RepurposeSourceInaccessibleError when the supplied source cannot be fetched', async () => {
    await expect(
      runRepurpose({
        pool,
        llm: buildLlm([]),
        fetchTool: fakeFetchTool(null),
        source: { kind: 'url', url: 'https://example.com/unreachable' },
        mode: 'repurpose',
        logger: noopLogger,
        runId: 'test-run',
      }),
    ).rejects.toBeInstanceOf(RepurposeSourceInaccessibleError);
  });
});
