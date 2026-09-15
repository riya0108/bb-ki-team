try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createChatSession, createPool, insertContentDna, listChatMessages } from '@bb/db';
import type { Pool } from '@bb/db';
import { ContentNotApprovedError } from '@bb/workflows';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleInstagramChatMessage, NoOpenDraftError } from './chat.js';
import type { InstagramChatDeps } from './chat.js';

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

function postDraftJson(): string {
  return JSON.stringify({
    concept: 'One idea',
    visualDirection: 'A clean graphic',
    coverText: 'Cover',
    headline: 'Headline',
    caption: 'Caption text.',
    firstLineHook: 'Hook',
    cta: null,
    hashtagsOptional: [],
    altText: 'Alt text',
    designNotes: 'Notes',
  });
}

function buildLlm(classifierResponse: Record<string, unknown>): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('intent classifier')) {
      return JSON.stringify(classifierResponse);
    }
    if (system.includes('Sub-Agent 03A')) return postDraftJson();
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/instagram chat (integration, real Postgres)', () => {
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
    sessionId = (await createChatSession(pool, 'instagram')).id;
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

  function buildDeps(llm: ReturnType<typeof createFakeLlmClient>): InstagramChatDeps {
    return { pool, llm, publishConnectors: {}, scheduleConnectors: {} };
  }

  it('drafts a post from a chat message with an explicit format and persists both chat turns', async () => {
    const deps = buildDeps(
      buildLlm({ action: 'draft', topic: 'A single stat about UPI', angle: 'One visual idea', format: 'post' }),
    );

    const result = await handleInstagramChatMessage(deps, 'Make me a post about UPI stats', { sessionId }, 'test-run');
    const pkg = result.result as { contentId: string; format: string };
    contentIdsThisTest.push(pkg.contentId);

    expect(result.action).toBe('draft');
    expect(pkg.format).toBe('post');
    expect(result.reply).toContain('post');

    const history = await listChatMessages(pool, sessionId);
    expect(history).toHaveLength(2);
    expect(history[1]?.action?.name).toBe('draft');
  });

  it('treats cross-format repurposing requests as unsupported rather than inventing new logic', async () => {
    const deps = buildDeps(
      buildLlm({ action: 'unsupported', reason: 'Turning an existing draft into a different format is not supported yet.' }),
    );

    const result = await handleInstagramChatMessage(deps, 'Turn this carousel into a Reel', { sessionId }, 'test-run');

    expect(result.reply).toBe(
      "I can't do that yet: Turning an existing draft into a different format is not supported yet.",
    );
  });

  it('surfaces a clear message instead of throwing when publish is requested with no open draft', async () => {
    const deps = buildDeps(buildLlm({ action: 'publish' }));

    const result = await handleInstagramChatMessage(deps, 'Publish this', { sessionId }, 'test-run');

    expect(result.reply).toBe(new NoOpenDraftError().message);
  });

  it('never fabricates a publish for a draft that has not been approved', async () => {
    const draftDeps = buildDeps(
      buildLlm({ action: 'draft', topic: 'A single stat about UPI', angle: 'One visual idea', format: 'post' }),
    );
    const draftResult = await handleInstagramChatMessage(draftDeps, 'Make me a post about UPI stats', { sessionId }, 'test-run');
    const pkg = draftResult.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    const publishDeps = buildDeps(buildLlm({ action: 'publish' }));
    await expect(
      handleInstagramChatMessage(publishDeps, 'Publish this', { sessionId, openContentId: pkg.contentId }, 'test-run'),
    ).rejects.toBeInstanceOf(ContentNotApprovedError);
  });
});
