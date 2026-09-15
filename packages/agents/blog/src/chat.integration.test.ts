try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createChatSession, createPool, insertContentDna, listChatMessages } from '@bb/db';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { ContentNotApprovedError } from '@bb/workflows';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleBlogChatMessage, NoOpenDraftError } from './chat.js';
import type { BlogChatDeps } from './chat.js';

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

function articleDraftJson(): string {
  return JSON.stringify({
    titleOptions: ['Why UPI Fees Are About To Change'],
    category: 'Personal Finance',
    metaDescription: 'A look at the RBI UPI fee proposal.',
    deck: 'What the proposal actually changes.',
    thesis: 'The fee hike splits the cost between merchants and consumers.',
    sections: [
      { heading: 'The proposal', body: 'RBI proposed raising the fee.', sourceNote: null },
      { heading: 'Who pays', body: 'Merchants and consumers split it.', sourceNote: null },
    ],
    practicalTakeaway: 'Watch your bill for a small increase.',
    conclusion: 'The fee hike is a split tax.',
    disclaimer: null,
    sources: [],
    articleSummary: 'An explainer on the RBI UPI fee proposal.',
    estimatedReadTime: '4 min',
    seoStatus: 'Good keyword coverage.',
    styleMatchStatus: 'Matches the baseline editorial voice.',
  });
}

function buildLlm(classifierResponse: Record<string, unknown>): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('intent classifier')) {
      return JSON.stringify(classifierResponse);
    }
    if (system.includes('Blog HTML Agent')) return articleDraftJson();
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

describeIfDb('packages/agents/blog chat (integration, real Postgres)', () => {
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
    sessionId = (await createChatSession(pool, 'blog')).id;
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

  function buildDeps(llm: ReturnType<typeof createFakeLlmClient>): BlogChatDeps {
    return { pool, llm, fetchTool: unusedFetchTool, publishConnectors: {}, scheduleConnectors: {} };
  }

  it('drafts an article from a chat message and persists both chat turns', async () => {
    const deps = buildDeps(buildLlm({ action: 'draft', topic: 'RBI UPI fee proposal', articleType: 'Explainer' }));

    const result = await handleBlogChatMessage(deps, 'Write a blog on the RBI UPI fee proposal', { sessionId }, 'test-run');
    const pkg = result.result as { contentId: string; title: string };
    contentIdsThisTest.push(pkg.contentId);

    expect(result.action).toBe('draft');
    expect(result.reply).toContain(pkg.title);

    const history = await listChatMessages(pool, sessionId);
    expect(history).toHaveLength(2);
    expect(history[1]?.action?.name).toBe('draft');
  });

  it('shows the HTML file for the currently open draft', async () => {
    const draftDeps = buildDeps(buildLlm({ action: 'draft', topic: 'RBI UPI fee proposal', articleType: 'Explainer' }));
    const draftResult = await handleBlogChatMessage(draftDeps, 'Write a blog on the RBI UPI fee proposal', { sessionId }, 'test-run');
    const pkg = draftResult.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    const showDeps = buildDeps(buildLlm({ action: 'show_html' }));
    const result = await handleBlogChatMessage(showDeps, 'Show me the HTML file', { sessionId, openContentId: pkg.contentId }, 'test-run');

    const shown = result.result as { htmlFile: string };
    expect(shown.htmlFile).toContain('<h1>');
  });

  it('replies honestly when the classifier cannot map the request to a supported action', async () => {
    const deps = buildDeps(buildLlm({ action: 'unsupported', reason: 'Editing an existing article is not supported yet.' }));

    const result = await handleBlogChatMessage(deps, 'Make it snappier', { sessionId }, 'test-run');

    expect(result.reply).toBe("I can't do that yet: Editing an existing article is not supported yet.");
  });

  it('surfaces a clear message instead of throwing when show_html is requested with no open draft', async () => {
    const deps = buildDeps(buildLlm({ action: 'show_html' }));

    const result = await handleBlogChatMessage(deps, 'Show me the HTML file', { sessionId }, 'test-run');

    expect(result.reply).toBe(new NoOpenDraftError().message);
  });

  it('never fabricates a publish for a draft that has not been approved', async () => {
    const draftDeps = buildDeps(buildLlm({ action: 'draft', topic: 'RBI UPI fee proposal', articleType: 'Explainer' }));
    const draftResult = await handleBlogChatMessage(draftDeps, 'Write a blog on the RBI UPI fee proposal', { sessionId }, 'test-run');
    const pkg = draftResult.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    const publishDeps = buildDeps(buildLlm({ action: 'publish' }));
    await expect(
      handleBlogChatMessage(publishDeps, 'Publish this', { sessionId, openContentId: pkg.contentId }, 'test-run'),
    ).rejects.toBeInstanceOf(ContentNotApprovedError);
  });
});
