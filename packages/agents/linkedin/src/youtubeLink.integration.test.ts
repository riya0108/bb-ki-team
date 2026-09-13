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
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { YoutubeTranscriptUnavailableError } from './errors.js';
import { runYoutubeLink } from './youtubeLink.js';

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

const unusedFetchTool: FetchTool = {
  fetchUrl(): Promise<FetchResult> {
    return Promise.reject(new Error('unused in youtube_link mode'));
  },
  close(): Promise<void> {
    return Promise.resolve();
  },
};

function fakeYoutubeTranscriptTool(text: string | null): YoutubeTranscriptTool {
  return {
    fetchTranscript(url: string): Promise<FetchResult> {
      if (text === null) throw new FetchToolError(url, 'no captions available');
      return Promise.resolve({
        sourceUrl: url,
        contentType: 'text/plain',
        title: 'A Test Video',
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
        factCheckStatus: 'Grounded in the video transcript.',
        originalityStatus: 'Adds the creator\'s take on the video.',
      });
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/linkedin YouTube Link mode (integration, real Postgres)', () => {
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

  it('drafts a post from the video transcript, labeled as youtube_link mode', async () => {
    const videoUrl = 'https://www.youtube.com/watch?v=abc123';
    const llm = buildLlm([
      {
        topic: 'Founder decision-making',
        coreClaim: null,
        angle: 'The video overstates how deliberate the decision actually was',
        relevanceScore: 0.85,
        riskLevel: 'low',
      },
    ]);

    const packages = await runYoutubeLink({
      pool,
      llm,
      fetchTool: unusedFetchTool,
      youtubeTranscriptTool: fakeYoutubeTranscriptTool('In this video I talk about a hard decision we made.'),
      videoUrl,
      logger: noopLogger,
      runId: 'test-run',
    });
    contentIdsThisTest.push(...packages.map((p) => p.contentId));

    expect(packages).toHaveLength(1);
    expect(packages[0]?.mode).toBe('youtube_link');
    expect(packages[0]?.sourceReferences).toEqual([videoUrl]);
  });

  it('throws YoutubeTranscriptUnavailableError when no transcript can be obtained', async () => {
    await expect(
      runYoutubeLink({
        pool,
        llm: buildLlm([]),
        fetchTool: unusedFetchTool,
        youtubeTranscriptTool: fakeYoutubeTranscriptTool(null),
        videoUrl: 'https://www.youtube.com/watch?v=nocaptions',
        logger: noopLogger,
        runId: 'test-run',
      }),
    ).rejects.toBeInstanceOf(YoutubeTranscriptUnavailableError);
  });
});
