try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna, insertContentItem } from '@bb/db';
import type { Pool } from '@bb/db';
import type { ContentDnaRecord } from '@bb/shared-types';
import { isUsableClaim } from '@bb/shared-types';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prepareEditorialBrief } from './pipeline.js';
import {
  createRbiFetchTool,
  createUnreachableFetchTool,
  RBI_BAD_HOOK,
  RBI_GOOD_HOOK,
  RBI_TOPIC,
  RBI_USER_MESSAGE,
  rbiEditorialResponse,
} from './testing/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

const dna: ContentDnaRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  version: 1,
  status: 'active',
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: [], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
  createdAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  confirmedBy: 'test',
};

function rbiLlm(): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => rbiEditorialResponse(input) ?? JSON.stringify({ status: 'PASS', notes: 'ok' }));
}

describeIfDb('prepareEditorialBrief (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let contentIds: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const { id: _id, version: _v, status: _s, createdAt: _c, confirmedAt: _ca, confirmedBy: _cb, ...body } = dna;
    dnaVersion = (await insertContentDna(pool, { version: Date.now() % 1_000_000, status: 'active', body })).version;
  });

  afterEach(async () => {
    if (contentIds.length > 0) await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [contentIds]);
    contentIds = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  it('RBI end-to-end: researches, verifies, ranks, and selects a hook that preserves "first since 2023"', async () => {
    const fetchTool = createRbiFetchTool();
    const brief = await prepareEditorialBrief(
      { pool, llm: rbiLlm(), fetchTool, logger: noopLogger },
      { topic: `${RBI_TOPIC} ${Date.now()}`, userMessage: RBI_USER_MESSAGE, contentDna: dna, runId: 'test-run', reuseExisting: false },
    );

    // Research ran automatically: the user never asked for it.
    expect(fetchTool.calls.some((u) => u.includes('rbi.org.in/pressreleases_rss.xml'))).toBe(true);
    expect(fetchTool.calls.some((u) => u.includes('reuters.com'))).toBe(true);
    expect(brief.kind).toBe('researched');

    // The user's fact was verified against the primary source and promoted into the ledger.
    const firstSince = brief.claims.find((c) => c.text.includes('first RBI rate hike since 2023'));
    expect(firstSince?.origin).toBe('user');
    expect(firstSince?.verificationStatus).toBe('VERIFIED');
    expect(firstSince?.mustPreserve).toBe(true);
    expect(brief.protectedClaimIds).toContain(firstSince?.id);
    expect(brief.storyEssence?.mostImportantFactClaimId).toBe(firstSince?.id);

    // Source lineage: claim -> source -> evidence.
    for (const claim of brief.claims.filter(isUsableClaim)) {
      expect(claim.evidence.some((e) => e.quoteFound)).toBe(true);
      for (const id of claim.sourceIds) expect(brief.sources.some((s) => s.id === id)).toBe(true);
    }

    // The critic scored the "again" hook highest, yet it was rejected; the selected hook
    // keeps the temporal fact and traces to claims.
    const bad = brief.hookCandidates.find((h) => h.candidate.text === RBI_BAD_HOOK);
    expect(bad?.rejected).toBe(true);
    expect(brief.hookCandidates.find((h) => h.candidate.text.includes('₹4,000'))?.rejected).toBe(true);
    expect(brief.selectedHooks[0]?.text).toBe(RBI_GOOD_HOOK);
    expect(brief.selectedHooks[0]?.supportingClaimIds).toContain(firstSince?.id);
    expect(brief.selectedAngle?.matchesUserIntent).toBe(true);
    expect(brief.thingsNotToSay.some((t) => t.includes('again'))).toBe(true);
  });

  it('reuses a recent brief for the same story instead of researching it again', async () => {
    const topic = `${RBI_TOPIC} reuse ${Date.now()}`;
    const first = await prepareEditorialBrief(
      { pool, llm: rbiLlm(), fetchTool: createRbiFetchTool(), logger: noopLogger },
      { topic, userMessage: RBI_USER_MESSAGE, contentDna: dna, runId: 'test-run' },
    );
    const item = await insertContentItem(pool, {
      platform: 'x',
      createdByAgent: 'test',
      mode: 'single_topic',
      contentDnaVersion: dnaVersion,
      text: 'x',
      package: { editorialBrief: first },
    });
    contentIds.push(item.id);

    const secondFetch = createRbiFetchTool();
    const second = await prepareEditorialBrief(
      { pool, llm: rbiLlm(), fetchTool: secondFetch, logger: noopLogger },
      { topic, contentDna: dna, runId: 'test-run-2' },
    );
    expect(second.id).toBe(first.id);
    expect(secondFetch.calls).toEqual([]);
  });

  it('never fabricates research: unreachable sources produce an insufficient-evidence brief with the user fact UNVERIFIED', async () => {
    const brief = await prepareEditorialBrief(
      { pool, llm: rbiLlm(), fetchTool: createUnreachableFetchTool(), logger: noopLogger },
      { topic: `${RBI_TOPIC} unreachable ${Date.now()}`, userMessage: RBI_USER_MESSAGE, contentDna: dna, runId: 'test-run', reuseExisting: false },
    );
    expect(brief.kind).toBe('insufficient_evidence');
    expect(brief.claims.every((c) => c.verificationStatus === 'UNVERIFIED')).toBe(true);
    expect(brief.claims[0]?.mustPreserve).toBe(true);
    expect(brief.research.failures.length).toBeGreaterThan(0);
    expect(brief.selectedHooks).toEqual([]);
  });

  it('does not research evergreen opinion requests (spec 45)', async () => {
    const fetchTool = createRbiFetchTool();
    const llm = createFakeLlmClient(() => 'not json'); // analyst unavailable -> deterministic fallback
    const brief = await prepareEditorialBrief(
      { pool, llm, fetchTool, logger: noopLogger },
      { topic: 'Give me 5 opinions about budgeting', contentDna: dna, runId: 'test-run', reuseExisting: false },
    );
    expect(brief.kind).toBe('opinion');
    expect(fetchTool.calls).toEqual([]);
  });
});
