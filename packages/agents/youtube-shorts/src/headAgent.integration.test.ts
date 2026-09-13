try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { FetchToolError } from '@bb/mcp-client';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { YoutubeTranscriptUnavailableError } from './errors.js';
import { runYoutubeShort } from './headAgent.js';
import { runYoutubeShortFromSource } from './repurpose.js';

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

function buildLlm(candidateIdea?: { topic: string; angle: string; coreClaim: string | null }): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('identifying one')) {
      return JSON.stringify(candidateIdea ?? { topic: 'UPI fees', angle: 'Who pays', coreClaim: null });
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

function fakeYoutubeTranscriptTool(text: string | null): YoutubeTranscriptTool {
  return {
    fetchTranscript(url: string): Promise<FetchResult> {
      if (text === null) throw new FetchToolError(url, 'no captions available');
      return Promise.resolve({
        sourceUrl: url,
        contentType: 'text/plain',
        title: 'A video',
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

describeIfDb('packages/agents/youtube-shorts head agent (integration, real Postgres)', () => {
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

  it('drafts a Short from a direct topic/angle and submits it for review', async () => {
    const pkg = await runYoutubeShort({
      pool,
      llm: buildLlm(),
      topic: 'UPI fees',
      angle: 'Who actually pays',
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.status).toBe('in_review');
    expect(pkg.spokenScript).toBe('This is the spoken script.');
    expect(pkg.visualBeats).toHaveLength(2);
    expect(pkg.contentDnaVersion).toBe(dnaVersion);
  });

  it('identifies one self-contained idea from a pasted transcript and drafts from it', async () => {
    const pkg = await runYoutubeShortFromSource({
      pool,
      llm: buildLlm({ topic: 'Founder pricing decisions', angle: 'Why the obvious price was wrong', coreClaim: null }),
      fetchTool: unusedFetchTool,
      youtubeTranscriptTool: fakeYoutubeTranscriptTool(null),
      source: { kind: 'text', label: 'Voice note transcript', text: 'A long rambling transcript about pricing.' },
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.topic).toBe('Founder pricing decisions');
    expect(pkg.sources).toEqual(['Voice note transcript']);
  });

  it('fetches a YouTube video transcript and drafts a Short from it', async () => {
    const videoUrl = 'https://www.youtube.com/watch?v=abc123';
    const pkg = await runYoutubeShortFromSource({
      pool,
      llm: buildLlm({ topic: 'UPI fees', angle: 'Who pays', coreClaim: null }),
      fetchTool: unusedFetchTool,
      youtubeTranscriptTool: fakeYoutubeTranscriptTool('A transcript about UPI fees from the video.'),
      source: { kind: 'youtube', videoUrl },
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.sources).toEqual([videoUrl]);
  });

  it('throws YoutubeTranscriptUnavailableError when the video has no transcript', async () => {
    await expect(
      runYoutubeShortFromSource({
        pool,
        llm: buildLlm(),
        fetchTool: unusedFetchTool,
        youtubeTranscriptTool: fakeYoutubeTranscriptTool(null),
        source: { kind: 'youtube', videoUrl: 'https://www.youtube.com/watch?v=nocaptions' },
        runId: 'r',
      }),
    ).rejects.toBeInstanceOf(YoutubeTranscriptUnavailableError);
  });
});
