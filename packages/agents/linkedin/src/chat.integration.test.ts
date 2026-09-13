try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna, listChatMessages } from '@bb/db';
import type { Pool } from '@bb/db';
import { FetchToolError } from '@bb/mcp-client';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { ContentNotApprovedError } from '@bb/workflows';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handleLinkedinChatMessage, NoOpenDraftError } from './chat.js';
import type { LinkedinChatDeps } from './chat.js';

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
    if (system.includes('Thought Leadership Head Agent')) {
      return JSON.stringify({
        hookOptions: ['A strong hook'],
        finalPost: 'HOOK\nCONTEXT\nINSIGHT\nMECHANISM\nEXAMPLE\nSO WHAT\nCLOSE',
        visualSuggestion: null,
        firstCommentOptional: null,
        factCheckStatus: "This post is entirely the creator's opinion.",
        originalityStatus: 'No source material; wholly original.',
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
const unusedYoutubeTool: YoutubeTranscriptTool = {
  fetchTranscript(url: string): Promise<FetchResult> {
    return Promise.reject(new FetchToolError(url, 'not used in this test'));
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

describeIfDb('packages/agents/linkedin chat (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let contentIdsThisTest: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, { version: Date.now() % 1_000_000, status: 'active', body: dnaBody });
    dnaVersion = dna.version;
  });

  afterEach(async () => {
    await pool.query("DELETE FROM chat_messages WHERE platform = 'linkedin'");
    if (contentIdsThisTest.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [contentIdsThisTest]);
    }
    contentIdsThisTest = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  function buildDeps(llm: ReturnType<typeof createFakeLlmClient>): LinkedinChatDeps {
    return {
      pool,
      llm,
      fetchTool: unusedFetchTool,
      youtubeTranscriptTool: unusedYoutubeTool,
      logger: noopLogger,
      publishConnectors: {},
      scheduleConnectors: {},
    };
  }

  it('drafts a post from a chat message and persists both chat turns', async () => {
    const deps = buildDeps(buildLlm({ action: 'draft', topic: 'UPI adoption', angle: 'A merchant-fee problem' }));

    const result = await handleLinkedinChatMessage(deps, 'Draft me a post about UPI adoption', {}, 'test-run');
    const pkg = result.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    expect(result.action).toBe('draft');
    expect(result.reply).toContain('UPI adoption');

    const history = await listChatMessages(pool, 'linkedin');
    expect(history).toHaveLength(2);
    expect(history[0]?.role).toBe('user');
    expect(history[1]?.role).toBe('assistant');
    expect(history[1]?.action?.name).toBe('draft');
  });

  it('replies honestly when the classifier cannot map the request to a supported action', async () => {
    const deps = buildDeps(
      buildLlm({ action: 'unsupported', reason: 'Cross-agent repurposing is not supported yet.' }),
    );

    const result = await handleLinkedinChatMessage(deps, 'Turn this into an Instagram Reel', {}, 'test-run');

    expect(result.reply).toBe("I can't do that yet: Cross-agent repurposing is not supported yet.");
  });

  it('surfaces a clear message instead of throwing when an edit is requested with no open draft', async () => {
    const deps = buildDeps(buildLlm({ action: 'edit', instruction: 'Make it punchier' }));

    const result = await handleLinkedinChatMessage(deps, 'Make it punchier', {}, 'test-run');

    expect(result.reply).toBe(new NoOpenDraftError().message);
  });

  it('never fabricates a publish for a draft that has not been approved', async () => {
    const draftDeps = buildDeps(buildLlm({ action: 'draft', topic: 'UPI adoption', angle: 'A merchant-fee problem' }));
    const draftResult = await handleLinkedinChatMessage(draftDeps, 'Draft me a post about UPI adoption', {}, 'test-run');
    const pkg = draftResult.result as { contentId: string };
    contentIdsThisTest.push(pkg.contentId);

    const publishDeps = buildDeps(buildLlm({ action: 'publish' }));
    await expect(
      handleLinkedinChatMessage(publishDeps, 'Publish this', { openContentId: pkg.contentId }, 'test-run'),
    ).rejects.toBeInstanceOf(ContentNotApprovedError);
  });
});
