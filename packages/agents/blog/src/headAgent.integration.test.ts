try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, getQaResultForVersion, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import {
  createRbiFetchTool,
  createUnreachableFetchTool,
  RBI_TOPIC,
  RBI_USER_MESSAGE,
  rbiEditorialResponse,
} from '@bb/editorial-intelligence/testing';
import { FetchToolError } from '@bb/mcp-client';
import type { FetchTool } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { RepurposeSourceInaccessibleError } from './errors.js';
import { runBlogArticle } from './headAgent.js';
import { runBlogArticleFromSource } from './repurpose.js';

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

function articleDraftJson(titleOptions: string[] = ['Why UPI Fees Are About To Change']): string {
  return JSON.stringify({
    titleOptions,
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

function buildLlm(): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
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

function fakeFetchTool(text: string | null): FetchTool {
  return {
    fetchUrl(url: string): Promise<FetchResult> {
      if (text === null) throw new FetchToolError(url, 'simulated unreachable source');
      return Promise.resolve({
        sourceUrl: url,
        contentType: 'text/html',
        title: null,
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

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

function rbiArticleJson(): string {
  return JSON.stringify({
    titleOptions: 'RBI Just Hiked Rates For The First Time Since 2023'.split('|'),
    category: 'Money',
    metaDescription: 'What the first RBI rate hike since 2023 means for borrowers.',
    deck: 'The repo rate went up 25 basis points. Here is what changes for your EMI.',
    thesis: 'The first hike since 2023 lands on repo-linked borrowers.',
    sections: [
      { heading: 'What happened', body: 'RBI raised the repo rate by 25 basis points to 5.50%. It is the first RBI rate hike since 2023.', sourceNote: 'Reserve Bank of India' },
      { heading: 'Why your EMI could change', body: 'Borrowers with floating-rate home and car loans linked to the repo rate could see higher EMIs.', sourceNote: 'Reuters' },
    ],
    practicalTakeaway: 'Check whether your loan is linked to the repo rate.',
    conclusion: 'Whether more hikes follow is not established yet.',
    disclaimer: null,
    sources: ['Reserve Bank of India', 'Reuters'],
    articleSummary: 'Explainer on the first RBI rate hike since 2023.',
    estimatedReadTime: '3 min',
    seoStatus: 'ok',
    styleMatchStatus: 'ok',
    supportingClaimIds: ['claim_001'],
  });
}

describeIfDb('packages/agents/blog head agent (integration, real Postgres)', () => {
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

  it('drafts an article, assembles valid HTML, and submits it for review', async () => {
    const pkg = await runBlogArticle({
      pool,
      llm: buildLlm(),
      fetchTool: createUnreachableFetchTool(),
      logger: noopLogger,
      topic: 'RBI UPI merchant fee proposal',
      articleType: 'Explainer',
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.status).toBe('in_review');
    expect(pkg.title).toBe('Why UPI Fees Are About To Change');
    expect(pkg.slug).toBe('why-upi-fees-are-about-to-change');
    expect(pkg.htmlFile).toContain('<h1>Why UPI Fees Are About To Change</h1>');
    expect(pkg.contentDnaVersion).toBe(dnaVersion);

    const row = await pool.query<{ package: { category: string } }>(
      'SELECT package FROM content_items WHERE id = $1',
      [pkg.contentId],
    );
    expect(row.rows[0]?.package.category).toBe('Personal Finance');
  });

  it('drafts a source-led article from a pasted transcript', async () => {
    const pkg = await runBlogArticleFromSource({
      pool,
      llm: buildLlm(),
      fetchTool: unusedFetchTool,
      logger: noopLogger,
      source: { kind: 'text', label: 'Podcast transcript', text: 'A long transcript about UPI fees.' },
      topic: 'RBI UPI merchant fee proposal',
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.sources).toEqual([]);
    const row = await pool.query<{ source_urls: string[] }>('SELECT source_urls FROM content_items WHERE id = $1', [
      pkg.contentId,
    ]);
    expect(row.rows[0]?.source_urls).toEqual(['Podcast transcript']);
  });

  it('drafts a source-led article from a fetched URL', async () => {
    const url = `https://example.com/article-${Date.now()}`;
    const pkg = await runBlogArticleFromSource({
      pool,
      llm: buildLlm(),
      fetchTool: fakeFetchTool('An article about UPI fees.'),
      logger: noopLogger,
      source: { kind: 'url', url },
      topic: 'RBI UPI merchant fee proposal',
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    const row = await pool.query<{ source_urls: string[] }>('SELECT source_urls FROM content_items WHERE id = $1', [
      pkg.contentId,
    ]);
    expect(row.rows[0]?.source_urls).toEqual([url]);
  });

  it('throws RepurposeSourceInaccessibleError when the supplied URL cannot be fetched', async () => {
    await expect(
      runBlogArticleFromSource({
        pool,
        llm: buildLlm(),
        fetchTool: fakeFetchTool(null),
        logger: noopLogger,
        source: { kind: 'url', url: 'https://example.com/unreachable' },
        topic: 'A topic',
        runId: 'r',
      }),
    ).rejects.toBeInstanceOf(RepurposeSourceInaccessibleError);
  });
  it('RBI end-to-end: the article is written from the verified brief and passes meaning-preservation QA', async () => {
    const llm = createFakeLlmClient((input) => {
      const editorial = rbiEditorialResponse(input);
      if (editorial !== null) return editorial;
      if ((input.system ?? '').includes('Blog HTML Agent')) {
        expect(input.messages[0]?.content).toContain('PROTECTED FACTS');
        return rbiArticleJson();
      }
      return JSON.stringify({ status: 'PASS', notes: 'ok' });
    });
    const fetchTool = createRbiFetchTool();
    const pkg = await runBlogArticle({
      pool,
      llm,
      fetchTool,
      logger: noopLogger,
      topic: `${RBI_TOPIC} blog-${Date.now()}`,
      userMessage: RBI_USER_MESSAGE.replace('an X post', 'a blog article'),
      articleType: 'News/context',
      runId: 'r',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(fetchTool.calls.length).toBeGreaterThan(0);
    expect(pkg.title).toContain('First Time Since 2023');
    expect(pkg.editorialSummary?.kind).toBe('researched');
    const qa = await getQaResultForVersion(pool, pkg.contentId, 1);
    expect(qa?.result.editorial?.temporalAccuracy.status).toBe('PASS');
    expect(qa?.result.editorial?.numberAccuracy.status).toBe('PASS');
    expect(qa?.result.editorial?.meaningPreservation.status).toBe('PASS');
  });
});
