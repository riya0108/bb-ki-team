try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { AddressInfo } from 'node:net';

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna, insertContentItem } from '@bb/db';
import type { Pool } from '@bb/db';
import { FetchToolError } from '@bb/mcp-client';
import type { FetchTool, ImageGenTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import type { FetchResult, QaResult } from '@bb/shared-types';
import { buildRbiEditorialBrief } from '@bb/shared-types/testing';
import { submitForReview } from '@bb/workflows';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AppDeps } from './deps.js';

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

const unusedImageGen: ImageGenTool = {
  generateImage(): ReturnType<ImageGenTool['generateImage']> {
    return Promise.reject(new Error('not used in this test'));
  },
  storeVisualAsset(): ReturnType<ImageGenTool['storeVisualAsset']> {
    return Promise.reject(new Error('not used in this test'));
  },
  signAsset(): ReturnType<ImageGenTool['signAsset']> {
    return Promise.reject(new Error('not used in this test'));
  },
  close(): Promise<void> {
    return Promise.resolve();
  },
};

function buildLlm(
  editClassification: {
    isVoiceLevelInstruction: boolean;
    summary: string;
    proposedChange: unknown;
  } = {
    isVoiceLevelInstruction: false,
    summary: 'one-off',
    proposedChange: null,
  },
): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('Single Topic mode')) {
      return JSON.stringify({ angles: [{ angle: 'An angle', description: 'A description' }] });
    }
    if (system.includes('classify an edit instruction')) {
      return JSON.stringify(editClassification);
    }
    if (system.includes('Thought Leadership Head Agent')) {
      return JSON.stringify({
        hookOptions: ['A strong hook'],
        finalPost: 'HOOK\nCONTEXT\nINSIGHT\nMECHANISM\nEXAMPLE\nSO WHAT\nCLOSE',
        visualSuggestion: null,
        firstCommentOptional: null,
        factCheckStatus: 'Entirely opinion.',
        originalityStatus: 'Original.',
      });
    }
    if (system.includes('generate three')) {
      return JSON.stringify({ angles: [{ angle: 'An X angle', description: 'A description' }] });
    }
    if (system.includes('X-native principles')) {
      return JSON.stringify({
        mode: 'single',
        hookOptions: ['A strong hook'],
        finalCopy: 'A sharp single X post.',
        threadPosts: null,
        factCheckStatus: 'Entirely opinion.',
      });
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('apps/api HTTP surface (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let server: Server;
  let baseUrl: string;
  let contentIdsThisTest: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, {
      version: Date.now() % 1_000_000,
      status: 'active',
      body: dnaBody,
    });
    dnaVersion = dna.version;

    const deps: AppDeps = {
      env: { databaseUrl: databaseUrl ?? '', apiPort: 0, apiHost: '127.0.0.1', visualAgentEnabled: false },
      pool,
      llm: buildLlm(),
      fetchTool: unusedFetchTool,
      youtubeTranscriptTool: unusedYoutubeTool,
      imageGen: unusedImageGen,
      logger: noopLogger,
      publishConnectors: {},
      scheduleConnectors: {},
    };
    const app = createApp(deps);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (contentIdsThisTest.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [
        contentIdsThisTest,
      ]);
    }
    contentIdsThisTest = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  it('GET /health returns ok', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('runs the single-topic angles -> draft -> approve -> get lifecycle end to end', async () => {
    const anglesResponse = await fetch(`${baseUrl}/linkedin/single-topic/angles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: 'UPI adoption' }),
    });
    expect(anglesResponse.status).toBe(200);
    const anglesBody = (await anglesResponse.json()) as { angles: { angle: string }[] };
    expect(anglesBody.angles.length).toBeGreaterThan(0);

    const draftResponse = await fetch(`${baseUrl}/linkedin/single-topic/draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: 'UPI adoption', angle: anglesBody.angles[0]?.angle }),
    });
    expect(draftResponse.status).toBe(201);
    const draftBody = (await draftResponse.json()) as {
      package: { contentId: string; status: string };
    };
    contentIdsThisTest.push(draftBody.package.contentId);
    expect(draftBody.package.status).toBe('in_review');

    const approveResponse = await fetch(
      `${baseUrl}/content/${draftBody.package.contentId}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, approvedBy: 'riya' }),
      },
    );
    expect(approveResponse.status).toBe(200);
    const approveBody = (await approveResponse.json()) as { item: { status: string } };
    expect(approveBody.item.status).toBe('approved');

    const getResponse = await fetch(`${baseUrl}/content/${draftBody.package.contentId}`);
    expect(getResponse.status).toBe(200);
    const getBody = (await getResponse.json()) as { item: { status: string } };
    expect(getBody.item.status).toBe('approved');

    // A manual draft-canvas edit on an approved item must return it to in_review
    // (spec 15.2) rather than silently keeping a stale approval.
    const reviseResponse = await fetch(
      `${baseUrl}/content/${draftBody.package.contentId}/revisions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newText: 'Manually rewritten by the dashboard user.',
          changedById: 'riya',
        }),
      },
    );
    expect(reviseResponse.status).toBe(201);
    const reviseBody = (await reviseResponse.json()) as {
      item: { status: string; currentText: string };
    };
    expect(reviseBody.item.status).toBe('in_review');
    expect(reviseBody.item.currentText).toBe('Manually rewritten by the dashboard user.');

    const revisionsResponse = await fetch(
      `${baseUrl}/content/${draftBody.package.contentId}/revisions`,
    );
    expect(revisionsResponse.status).toBe(200);
    const revisionsBody = (await revisionsResponse.json()) as {
      revisions: { changeType: string }[];
    };
    expect(revisionsBody.revisions.some((r) => r.changeType === 'user_edit')).toBe(true);

    const publishEventsResponse = await fetch(
      `${baseUrl}/content/${draftBody.package.contentId}/publish-events`,
    );
    expect(publishEventsResponse.status).toBe(200);
    const publishEventsBody = (await publishEventsResponse.json()) as { events: unknown[] };
    expect(publishEventsBody.events).toEqual([]);
  });

  it('runs the X single-post draft -> edit lifecycle end to end', async () => {
    const anglesResponse = await fetch(`${baseUrl}/x/angles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: 'UPI adoption' }),
    });
    expect(anglesResponse.status).toBe(200);
    const anglesBody = (await anglesResponse.json()) as { angles: { angle: string }[] };
    expect(anglesBody.angles.length).toBeGreaterThan(0);

    const draftResponse = await fetch(`${baseUrl}/x/single-post/draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: 'UPI adoption', angle: anglesBody.angles[0]?.angle }),
    });
    expect(draftResponse.status).toBe(201);
    const draftBody = (await draftResponse.json()) as {
      package: { contentId: string; mode: string; status: string };
    };
    contentIdsThisTest.push(draftBody.package.contentId);
    expect(draftBody.package.mode).toBe('single');
    expect(draftBody.package.status).toBe('in_review');

    const editResponse = await fetch(`${baseUrl}/x/edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contentId: draftBody.package.contentId,
        instruction: 'Make the hook punchier',
      }),
    });
    expect(editResponse.status).toBe(200);
    const editBody = (await editResponse.json()) as { package: { finalCopy: string } };
    expect(editBody.package.finalCopy).toBe('A sharp single X post.');
  });

  it('re-runs fact/meaning QA on a manual edit and exposes it via GET /content/:id/qa (RBI regression)', async () => {
    const brief = buildRbiEditorialBrief({ contentDnaVersion: dnaVersion });
    const item = await insertContentItem(pool, {
      platform: 'x',
      createdByAgent: 'agent-02-x',
      mode: 'single_topic',
      topic: brief.topic,
      contentDnaVersion: dnaVersion,
      text: 'RBI just hiked rates for the first time since 2023.',
      package: { mode: 'single', editorialBrief: brief },
    });
    contentIdsThisTest.push(item.id);
    await submitForReview(pool, item.id);

    const reviseResponse = await fetch(`${baseUrl}/content/${item.id}/revisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newText: 'RBI just hiked rates again. Brace your EMI.', changedById: 'riya' }),
    });
    expect(reviseResponse.status).toBe(201);

    const qaResponse = await fetch(`${baseUrl}/content/${item.id}/qa`);
    expect(qaResponse.status).toBe(200);
    const qaBody = (await qaResponse.json()) as { version: number; qa: QaResult | null };
    expect(qaBody.version).toBe(2);
    expect(qaBody.qa?.editorial?.temporalAccuracy.status).toBe('FAIL');
    expect(qaBody.qa?.overallStatus).toBe('BLOCKED');
  });

  it('returns 404 with a structured body for an unknown content id', async () => {
    const response = await fetch(`${baseUrl}/content/00000000-0000-0000-0000-000000000099`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ContentItemNotFoundError');
  });

  it('returns 400 with a structured body for an invalid request', async () => {
    const response = await fetch(`${baseUrl}/linkedin/single-topic/draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: '' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('ValidationError');
  });

  it('surfaces a voice-level edit as a pending learning event, then applies it on confirm', async () => {
    // This test needs a different LLM script (one that recognizes the edit-instruction
    // classifier prompt as voice-level) than the shared server above, so it spins up
    // its own app/server against the same pool and Content DNA.
    const learningLlm = buildLlm({
      isVoiceLevelInstruction: true,
      summary: 'Creator never wants exclamation marks.',
      proposedChange: { voice: { forbiddenPhrases: ['!'] } },
    });
    const deps: AppDeps = {
      env: { databaseUrl: databaseUrl ?? '', apiPort: 0, apiHost: '127.0.0.1', visualAgentEnabled: false },
      pool,
      llm: learningLlm,
      fetchTool: unusedFetchTool,
      youtubeTranscriptTool: unusedYoutubeTool,
      imageGen: unusedImageGen,
      logger: noopLogger,
      publishConnectors: {},
      scheduleConnectors: {},
    };
    const learningApp = createApp(deps);
    const learningServer = learningApp.listen(0);
    await new Promise<void>((resolve) => learningServer.once('listening', resolve));
    const learningBaseUrl = `http://127.0.0.1:${(learningServer.address() as AddressInfo).port}`;

    try {
      const draftResponse = await fetch(`${learningBaseUrl}/linkedin/single-topic/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: 'UPI adoption', angle: 'An angle' }),
      });
      const draftBody = (await draftResponse.json()) as { package: { contentId: string } };
      contentIdsThisTest.push(draftBody.package.contentId);

      const editResponse = await fetch(`${learningBaseUrl}/linkedin/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contentId: draftBody.package.contentId,
          instruction: 'Never use exclamation marks in any post',
        }),
      });
      expect(editResponse.status).toBe(200);
      const editBody = (await editResponse.json()) as {
        learningEvent: { id: string; appliedToDna: boolean };
      };
      expect(editBody.learningEvent).not.toBeNull();
      expect(editBody.learningEvent.appliedToDna).toBe(false);

      const pendingResponse = await fetch(`${learningBaseUrl}/content-dna/learning-events`);
      const pendingBody = (await pendingResponse.json()) as { events: { id: string }[] };
      expect(pendingBody.events.map((e) => e.id)).toContain(editBody.learningEvent.id);

      const confirmResponse = await fetch(
        `${learningBaseUrl}/content-dna/learning-events/${editBody.learningEvent.id}/confirm`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmedBy: 'riya' }),
        },
      );
      expect(confirmResponse.status).toBe(200);
      const confirmBody = (await confirmResponse.json()) as {
        contentDna: { version: number; voice: { forbiddenPhrases: string[] } };
      };
      expect(confirmBody.contentDna.version).toBe(dnaVersion + 1);
      expect(confirmBody.contentDna.voice.forbiddenPhrases).toContain('!');

      const stillPendingResponse = await fetch(`${learningBaseUrl}/content-dna/learning-events`);
      const stillPendingBody = (await stillPendingResponse.json()) as { events: { id: string }[] };
      expect(stillPendingBody.events.map((e) => e.id)).not.toContain(editBody.learningEvent.id);

      await pool.query('DELETE FROM learning_events WHERE id = $1', [editBody.learningEvent.id]);
      await pool.query('DELETE FROM content_dna WHERE version = $1', [
        confirmBody.contentDna.version,
      ]);
    } finally {
      await new Promise<void>((resolve) => learningServer.close(() => resolve()));
    }
  });
});
