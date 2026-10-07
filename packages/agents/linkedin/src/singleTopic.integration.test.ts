try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { loadCurrentDna } from '@bb/content-dna';
import { createPool, getQaResultForVersion, insertContentDna, insertContentItem } from '@bb/db';
import type { Pool } from '@bb/db';
import { prepareEditorialBrief } from '@bb/editorial-intelligence';
import {
  createRbiFetchTool,
  createUnreachableFetchTool,
  RBI_GOOD_HOOK,
  RBI_TOPIC,
  RBI_USER_MESSAGE,
  rbiEditorialResponse,
} from '@bb/editorial-intelligence/testing';
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

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

const RBI_LINKEDIN_POST = `${RBI_GOOD_HOOK}

The repo rate went up by 25 basis points to 5.50%.

If your home or car loan is linked to the repo rate, your EMI could go up.

What to watch: whether this first hike since 2023 is a one-off.`;

function rbiLlm(): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const editorial = rbiEditorialResponse(input);
    if (editorial !== null) return editorial;
    if ((input.system ?? '').includes('Thought Leadership Head Agent')) {
      expect(input.messages[0]?.content).toContain('EDITORIAL BRIEF');
      return JSON.stringify({
        hookOptions: [RBI_GOOD_HOOK],
        finalPost: RBI_LINKEDIN_POST,
        visualSuggestion: null,
        firstCommentOptional: null,
        factCheckStatus: 'Verified against RBI and Reuters.',
        originalityStatus: 'Original framing.',
        supportingClaimIds: ['claim_001'],
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
      fetchTool: createUnreachableFetchTool(),
      logger: noopLogger,
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
  it('reuses the brief another platform built for the same story and checks cross-platform consistency', async () => {
    const topic = `${RBI_TOPIC} li-${Date.now()}`;
    const dna = await loadCurrentDna(pool);
    // An X draft of the same story already exists, built from this brief — and it drifted.
    const brief = await prepareEditorialBrief(
      { pool, llm: rbiLlm(), fetchTool: createRbiFetchTool(), logger: noopLogger },
      { topic, userMessage: RBI_USER_MESSAGE, contentDna: dna, runId: 'test-run' },
    );
    const xItem = await insertContentItem(pool, {
      platform: 'x',
      createdByAgent: 'agent-02-x',
      mode: 'single_topic',
      topic,
      contentDnaVersion: dnaVersion,
      text: 'RBI has resumed its rate-hiking cycle.',
      package: { editorialBrief: brief },
    });
    contentIdsThisTest.push(xItem.id);

    const fetchTool = createRbiFetchTool();
    const pkg = await draftSingleTopicPost({
      pool,
      llm: rbiLlm(),
      fetchTool,
      logger: noopLogger,
      topic,
      angle: null,
      userMessage: RBI_USER_MESSAGE,
      runId: 'test-run',
    });
    contentIdsThisTest.push(pkg.contentId);

    // One research pass per story: LinkedIn reused X's brief instead of fetching again.
    expect(fetchTool.calls).toEqual([]);
    expect(pkg.editorialSummary?.briefId).toBe(brief.id);
    expect(pkg.finalPost).toContain('first time since 2023');

    const qa = await getQaResultForVersion(pool, pkg.contentId, 1);
    expect(qa?.result.editorial?.temporalAccuracy.status).toBe('PASS');
    expect(qa?.result.editorial?.crossPlatformConsistency.status).toBe('WARN');
    expect(qa?.result.editorial?.crossPlatformConsistency.evidence?.join(' ')).toContain('x draft contradicts');
  });
});
