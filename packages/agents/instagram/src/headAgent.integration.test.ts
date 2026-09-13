try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runInstagramHead } from './headAgent.js';

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

function carouselDraftJson(): string {
  return JSON.stringify({
    title: 'Title',
    coverHook: 'Cover hook',
    slides: [
      { number: 1, headline: 'Slide 1', body: 'Body 1', visualDirection: 'Visual 1', sourceNote: null },
      { number: 2, headline: 'Slide 2', body: 'Body 2', visualDirection: 'Visual 2', sourceNote: null },
      { number: 3, headline: 'Slide 3', body: 'Body 3', visualDirection: 'Visual 3', sourceNote: null },
    ],
    caption: 'Caption text.',
    cta: null,
    altText: 'Alt text',
    designSystem: 'System',
  });
}

function reelDraftJson(): string {
  return JSON.stringify({
    concept: 'One idea',
    hook: 'Hook',
    spokenScript: 'This is the spoken script.',
    onScreenText: ['text 1'],
    sceneByScene: ['scene 1'],
    bRoll: [],
    visualProof: null,
    pacingNotes: null,
    caption: 'Caption text.',
    coverText: 'Cover',
    cta: null,
    audioNoteOptional: null,
    editingNotes: null,
    factSources: [],
  });
}

function buildLlm(routedFormat: 'post' | 'carousel' | 'reel'): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('primary responsibility for this idea is deciding')) {
      return JSON.stringify({ format: routedFormat, reasoning: 'test' });
    }
    if (system.includes('Sub-Agent 03A')) return postDraftJson();
    if (system.includes('Sub-Agent 03B')) return carouselDraftJson();
    if (system.includes('Sub-Agent 03C')) return reelDraftJson();
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/instagram head agent (integration, real Postgres)', () => {
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

  it('routes to Posts and returns a valid INSTAGRAM_POST package', async () => {
    const pkg = await runInstagramHead({
      pool,
      llm: buildLlm('post'),
      topic: 'A single stat about UPI',
      angle: 'One visual idea',
      runId: 'r',
    });
    if (pkg.format !== 'post') throw new Error('expected post format');
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.status).toBe('in_review');
    expect(pkg.contentDnaVersion).toBe(dnaVersion);
    expect(pkg.caption).toBe('Caption text.');
  });

  it('routes to Carousels and returns a valid INSTAGRAM_CAROUSEL package with slideCount matching slides', async () => {
    const pkg = await runInstagramHead({
      pool,
      llm: buildLlm('carousel'),
      topic: 'How UPI fees work',
      angle: 'Step by step breakdown',
      runId: 'r',
    });
    if (pkg.format !== 'carousel') throw new Error('expected carousel format');
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.slides).toHaveLength(3);
    expect(pkg.slideCount).toBe(3);

    const row = await pool.query<{ package: { slides: unknown[] } }>(
      'SELECT package FROM content_items WHERE id = $1',
      [pkg.contentId],
    );
    expect(row.rows[0]?.package.slides).toHaveLength(3);
  });

  it('routes to Reels and returns a valid INSTAGRAM_REEL package', async () => {
    const pkg = await runInstagramHead({
      pool,
      llm: buildLlm('reel'),
      topic: 'A founder story',
      angle: 'High-retention narrative',
      runId: 'r',
    });
    if (pkg.format !== 'reel') throw new Error('expected reel format');
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.spokenScript).toBe('This is the spoken script.');
    expect(pkg.sceneByScene).toHaveLength(1);
  });

  it('lets an explicit format override skip routing entirely', async () => {
    let routingCalled = false;
    const llm = createFakeLlmClient((input) => {
      const system = input.system ?? '';
      if (system.includes('primary responsibility for this idea is deciding')) {
        routingCalled = true;
        return JSON.stringify({ format: 'post', reasoning: 'should not be called' });
      }
      if (system.includes('Sub-Agent 03C')) return reelDraftJson();
      return JSON.stringify({ status: 'PASS', notes: 'ok' });
    });

    const pkg = await runInstagramHead({
      pool,
      llm,
      topic: 'A founder story',
      angle: 'Explicitly requested as a Reel',
      format: 'reel',
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.format).toBe('reel');
    expect(routingCalled).toBe(false);
  });
});
