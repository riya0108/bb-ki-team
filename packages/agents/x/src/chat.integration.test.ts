try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { createChatSession, createPool, insertContentDna, listChatMessages } from '@bb/db';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { ContentNotApprovedError } from '@bb/workflows';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleXChatMessage, NoOpenDraftError } from './chat.js';
import type { XChatDeps } from './chat.js';

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

function buildLlm(classifierResponse: Record<string, unknown>): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('intent classifier')) {
      return JSON.stringify(classifierResponse);
    }
    if (system.includes('X-native principles')) {
      return JSON.stringify({
        mode: 'single',
        hookOptions: ['A strong hook'],
        finalCopy: 'A single sharp post about UPI.',
        threadPosts: null,
        factCheckStatus: 'Opinion.',
      });
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

const unusedFetchTool: FetchTool = {
  fetchUrl(): Promise<FetchResult> {
    return Promise.reject(new Error('not used in this test'));
  },
  close(): Promise<void> {
    return Promise.resolve();
  },
};
const noopLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

describeIfDb('packages/agents/x chat (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let contentIdsThisTest: string[] = [];
  let sessionId: string;

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, { version: Date.now() % 1_000_000, status: 'active', body: dnaBody });
    dnaVersion = dna.version;
  });

  beforeEach(async () => {
    sessionId = (await createChatSession(pool, 'x')).id;
  });

  afterEach(async () => {
    // Cascades to that session's chat_messages (migration 0015's FK).
    await pool.query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]);
    if (contentIdsThisTest.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [contentIdsThisTest]);
    }
    contentIdsThisTest = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  function buildDeps(llm: ReturnType<typeof createFakeLlmClient>): XChatDeps {
    return {
      pool,
      llm,
      fetchTool: unusedFetchTool,
      logger: noopLogger,
      publishConnectors: {},
      scheduleConnectors: {},
    };
  }

  it('drafts a post from a chat message and persists both chat turns', async () => {
    const deps = buildDeps(buildLlm({ action: 'draft', topic: 'UPI adoption', angle: 'A merchant-fee problem' }));

    const result = await handleXChatMessage(deps, 'Draft me a post about UPI adoption', { sessionId }, 'test-run');
    const pkg = result.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    expect(result.action).toBe('draft');
    expect(result.reply).toContain('UPI adoption');

    const history = await listChatMessages(pool, sessionId);
    expect(history).toHaveLength(2);
    expect(history[1]?.action?.name).toBe('draft');
  });

  it('replies honestly when the classifier cannot map the request to a supported action', async () => {
    const deps = buildDeps(buildLlm({ action: 'unsupported', reason: 'No matching action.' }));

    const result = await handleXChatMessage(deps, 'Do something unrelated', { sessionId }, 'test-run');

    expect(result.reply).toBe("I can't do that yet: No matching action.");
  });

  it('surfaces a clear message instead of throwing when an edit is requested with no open draft', async () => {
    const deps = buildDeps(buildLlm({ action: 'edit', instruction: 'Make it punchier' }));

    const result = await handleXChatMessage(deps, 'Make it punchier', { sessionId }, 'test-run');

    expect(result.reply).toBe(new NoOpenDraftError().message);
  });

  it('never fabricates a publish for a draft that has not been approved', async () => {
    const draftDeps = buildDeps(buildLlm({ action: 'draft', topic: 'UPI adoption', angle: 'A merchant-fee problem' }));
    const draftResult = await handleXChatMessage(draftDeps, 'Draft me a post about UPI adoption', { sessionId }, 'test-run');
    const pkg = draftResult.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    const publishDeps = buildDeps(buildLlm({ action: 'publish' }));
    await expect(
      handleXChatMessage(publishDeps, 'Publish this', { sessionId, openContentId: pkg.contentId }, 'test-run'),
    ).rejects.toBeInstanceOf(ContentNotApprovedError);
  });
});
