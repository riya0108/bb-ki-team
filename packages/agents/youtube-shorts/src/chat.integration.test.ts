try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createChatSession, createPool, insertContentDna, listChatMessages } from '@bb/db';
import type { Pool } from '@bb/db';
import { FetchToolError } from '@bb/mcp-client';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { ContentNotApprovedError } from '@bb/workflows';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleYoutubeShortsChatMessage, NoOpenDraftError } from './chat.js';
import type { YoutubeShortsChatDeps } from './chat.js';

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

function shortDraftJson(): string {
  return JSON.stringify({
    corePromise: 'Learn who pays UPI fees.',
    hookOptions: ['hook'],
    titleOptions: ['title'],
    spokenScript: 'This is the spoken script.',
    visualBeats: ['beat 1', 'beat 2'],
    onScreenText: ['text'],
    bRoll: [],
    editingPacing: null,
    description: 'desc',
    cta: null,
  });
}

function buildLlm(classifierResponse: Record<string, unknown>): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('intent classifier')) {
      return JSON.stringify(classifierResponse);
    }
    if (system.includes('Shorts-specific optimisation')) {
      return shortDraftJson();
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
const unusedYoutubeTool: YoutubeTranscriptTool = {
  fetchTranscript(url: string): Promise<FetchResult> {
    return Promise.reject(new FetchToolError(url, 'not used in this test'));
  },
  close(): Promise<void> {
    return Promise.resolve();
  },
};

describeIfDb('packages/agents/youtube-shorts chat (integration, real Postgres)', () => {
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
    sessionId = (await createChatSession(pool, 'youtube-shorts')).id;
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

  function buildDeps(llm: ReturnType<typeof createFakeLlmClient>): YoutubeShortsChatDeps {
    return { pool, llm, fetchTool: unusedFetchTool, youtubeTranscriptTool: unusedYoutubeTool, publishConnectors: {}, scheduleConnectors: {} };
  }

  it('drafts a short from a chat message and persists both chat turns', async () => {
    const deps = buildDeps(buildLlm({ action: 'draft', topic: 'UPI fees', angle: 'Who pays' }));

    const result = await handleYoutubeShortsChatMessage(deps, 'Draft a Short about who pays UPI fees', { sessionId }, 'test-run');
    const pkg = result.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    expect(result.action).toBe('draft');
    expect(result.reply).toContain('UPI fees');

    const history = await listChatMessages(pool, sessionId);
    expect(history).toHaveLength(2);
    expect(history[1]?.action?.name).toBe('draft');
  });

  it('replies honestly when the classifier cannot map the request to a supported action', async () => {
    const deps = buildDeps(buildLlm({ action: 'unsupported', reason: 'Editing an existing script is not supported yet.' }));

    const result = await handleYoutubeShortsChatMessage(deps, 'Make the script funnier', { sessionId }, 'test-run');

    expect(result.reply).toBe("I can't do that yet: Editing an existing script is not supported yet.");
  });

  it('surfaces a clear message instead of throwing when publish is requested with no open draft', async () => {
    const deps = buildDeps(buildLlm({ action: 'publish' }));

    const result = await handleYoutubeShortsChatMessage(deps, 'Publish this', { sessionId }, 'test-run');

    expect(result.reply).toBe(new NoOpenDraftError().message);
  });

  it('never fabricates a publish for a draft that has not been approved', async () => {
    const draftDeps = buildDeps(buildLlm({ action: 'draft', topic: 'UPI fees', angle: 'Who pays' }));
    const draftResult = await handleYoutubeShortsChatMessage(draftDeps, 'Draft a Short about UPI fees', { sessionId }, 'test-run');
    const pkg = draftResult.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    const publishDeps = buildDeps(buildLlm({ action: 'publish' }));
    await expect(
      handleYoutubeShortsChatMessage(publishDeps, 'Publish this', { sessionId, openContentId: pkg.contentId }, 'test-run'),
    ).rejects.toBeInstanceOf(ContentNotApprovedError);
  });
});
