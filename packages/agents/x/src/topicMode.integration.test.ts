try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { loadCurrentDna } from '@bb/content-dna';
import { createPool, getQaResultForVersion, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import {
  createRbiFetchTool,
  createUnreachableFetchTool,
  RBI_GOOD_HOOK,
  RBI_TOPIC,
  RBI_USER_MESSAGE,
  rbiEditorialResponse,
} from '@bb/editorial-intelligence/testing';
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

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

// Writer for the RBI end-to-end tests: echoes the first approved hook from the brief it
// was given (so the test proves the brief reached the writer), or a fixed drifting post.
function rbiLlm(writer: (system: string, user: string, call: number) => string): ReturnType<typeof createFakeLlmClient> {
  let writerCalls = 0;
  return createFakeLlmClient((input) => {
    const editorial = rbiEditorialResponse(input);
    if (editorial !== null) return editorial;
    const system = input.system ?? '';
    if (system.includes('X-native principles')) {
      writerCalls += 1;
      return writer(system, input.messages[0]?.content ?? '', writerCalls);
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

function xDraft(finalCopy: string): string {
  return JSON.stringify({
    mode: 'single',
    hookOptions: [finalCopy],
    finalCopy,
    threadPosts: null,
    factCheckStatus: 'Verified against RBI and Reuters.',
    supportingClaimIds: ['claim_001'],
  });
}

function approvedHookFrom(user: string): string {
  const match = /APPROVED HOOKS[^\n]*\n- \[[^\]]*\] (.+)/.exec(user);
  if (!match?.[1]) throw new Error('writer prompt carried no approved hook');
  return match[1];
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
      fetchTool: createUnreachableFetchTool(),
      logger: noopLogger,
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
      fetchTool: createUnreachableFetchTool(),
      logger: noopLogger,
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
  it('RBI end-to-end: researches automatically and drafts from the verified brief, preserving "first since 2023"', async () => {
    const fetchTool = createRbiFetchTool();
    const pkg = await draftXTopicPost({
      pool,
      llm: rbiLlm((_system, user) => xDraft(approvedHookFrom(user))),
      fetchTool,
      logger: noopLogger,
      topic: `${RBI_TOPIC} x-${Date.now()}`,
      angle: null,
      userMessage: RBI_USER_MESSAGE,
      mode: 'single_topic',
      runId: 'test-run',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(fetchTool.calls.length).toBeGreaterThan(0);
    expect(pkg.finalCopy).toBe(RBI_GOOD_HOOK);
    expect(pkg.finalCopy).toContain('for the first time since 2023');
    expect(pkg.finalCopy).not.toMatch(/\bagain\b/);
    expect(pkg.angle).toBe('The first hike since 2023 lands on borrowers');
    expect(pkg.editorialSummary?.selectedHook).toBe(RBI_GOOD_HOOK);
    expect(pkg.sourceReferences.some((u) => u.includes('rbi.org.in'))).toBe(true);

    const qa = await getQaResultForVersion(pool, pkg.contentId, 1);
    expect(qa?.result.editorial?.temporalAccuracy.status).toBe('PASS');
    expect(qa?.result.editorial?.meaningPreservation.status).toBe('PASS');
    expect(qa?.result.editorial?.hookTraceability.status).toBe('PASS');
  });

  it('RBI regression: a writer that says "again" is redrafted once, and if it persists QA blocks it for human review', async () => {
    const stubborn = await draftXTopicPost({
      pool,
      llm: rbiLlm(() => xDraft('RBI just hiked rates again. If you have a home loan, your EMI could rise.')),
      fetchTool: createRbiFetchTool(),
      logger: noopLogger,
      topic: `${RBI_TOPIC} stubborn-${Date.now()}`,
      angle: null,
      userMessage: RBI_USER_MESSAGE,
      mode: 'single_topic',
      runId: 'test-run',
    });
    contentIdsThisTest.push(stubborn.contentId);
    const qa = await getQaResultForVersion(pool, stubborn.contentId, 1);
    expect(stubborn.status).toBe('in_review');
    expect(qa?.result.editorial?.temporalAccuracy.status).toBe('FAIL');
    expect(qa?.result.overallStatus).toBe('BLOCKED');

    const corrected = await draftXTopicPost({
      pool,
      llm: rbiLlm((_system, user, call) =>
        call === 1
          ? xDraft('RBI just hiked rates again. If you have a home loan, your EMI could rise.')
          : (expect(user).toContain('first occurrence'), xDraft(approvedHookFrom(user))),
      ),
      fetchTool: createRbiFetchTool(),
      logger: noopLogger,
      topic: `${RBI_TOPIC} corrected-${Date.now()}`,
      angle: null,
      userMessage: RBI_USER_MESSAGE,
      mode: 'single_topic',
      runId: 'test-run',
    });
    contentIdsThisTest.push(corrected.contentId);
    expect(corrected.finalCopy).toContain('first time since 2023');
  });
});
