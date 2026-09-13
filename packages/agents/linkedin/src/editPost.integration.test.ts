try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { ContentItemNotFoundError, createContentItem, recordApproval, submitForReview } from '@bb/workflows';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { reviseLinkedinPost } from './editPost.js';

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

function buildLlm(
  revisedText: string,
  classification: { isVoiceLevelInstruction: boolean; summary: string; proposedChange: unknown } = {
    isVoiceLevelInstruction: false,
    summary: 'One-off content tweak.',
    proposedChange: null,
  },
): ReturnType<typeof createFakeLlmClient> {
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('Edit mode')) {
      return JSON.stringify({
        hookOptions: ['A punchier hook'],
        finalPost: revisedText,
        visualSuggestion: null,
        firstCommentOptional: null,
        factCheckStatus: 'Unchanged from the original.',
        originalityStatus: 'Same angle, revised wording.',
      });
    }
    if (system.includes('classify an edit instruction')) {
      return JSON.stringify(classification);
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/linkedin edit mode (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let contentIdsThisTest: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, { version: Date.now() % 1_000_000, status: 'active', body: dnaBody });
    dnaVersion = dna.version;
  });

  afterEach(async () => {
    // learning_events.content_id is ON DELETE SET NULL (not CASCADE — see migration
    // 0008), so it's deleted explicitly here rather than relying on the content_items
    // cleanup below to clear it.
    await pool.query('DELETE FROM learning_events WHERE content_id = ANY($1::uuid[])', [contentIdsThisTest]);
    if (contentIdsThisTest.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [contentIdsThisTest]);
    }
    contentIdsThisTest = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  it('revises an in_review post, bumps its version, and re-runs QA', async () => {
    const item = await createContentItem(pool, {
      platform: 'linkedin',
      createdByAgent: 'agent-01-linkedin',
      mode: 'single_topic',
      topic: 'UPI adoption',
      angle: 'An angle',
      contentDnaVersion: dnaVersion,
      text: 'Original post text.',
    });
    contentIdsThisTest.push(item.id);
    await submitForReview(pool, item.id);

    const { package: pkg, learningEvent } = await reviseLinkedinPost({
      pool,
      llm: buildLlm('Revised post text, punchier hook.'),
      contentId: item.id,
      instruction: 'Make the hook punchier',
      runId: 'test-run',
    });

    expect(pkg.finalPost).toBe('Revised post text, punchier hook.');
    expect(pkg.status).toBe('in_review');
    expect(learningEvent).toBeNull();

    const revisions = await pool.query<{ version: number; reason: string | null }>(
      'SELECT version, reason FROM revisions WHERE content_id = $1 ORDER BY version',
      [item.id],
    );
    expect(revisions.rows.at(-1)?.version).toBe(2);
    expect(revisions.rows.at(-1)?.reason).toBe('Make the hook punchier');
  });

  it('invalidates an existing approval and returns the item to review when edited', async () => {
    const item = await createContentItem(pool, {
      platform: 'linkedin',
      createdByAgent: 'agent-01-linkedin',
      mode: 'single_topic',
      topic: 'UPI adoption',
      angle: 'An angle',
      contentDnaVersion: dnaVersion,
      text: 'Approved post text.',
    });
    contentIdsThisTest.push(item.id);
    await submitForReview(pool, item.id);
    await recordApproval(pool, item.id, 1, 'riya');

    const { package: pkg } = await reviseLinkedinPost({
      pool,
      llm: buildLlm('Edited after approval.'),
      contentId: item.id,
      instruction: 'Tighten the close',
      runId: 'test-run',
    });

    expect(pkg.status).toBe('in_review');
    expect(pkg.finalPost).toBe('Edited after approval.');
  });

  it('records a learning event when the instruction reads as a voice-level preference, without changing Content DNA', async () => {
    const item = await createContentItem(pool, {
      platform: 'linkedin',
      createdByAgent: 'agent-01-linkedin',
      mode: 'single_topic',
      topic: 'UPI adoption',
      angle: 'An angle',
      contentDnaVersion: dnaVersion,
      text: 'Original post text.',
    });
    contentIdsThisTest.push(item.id);
    await submitForReview(pool, item.id);

    const { learningEvent } = await reviseLinkedinPost({
      pool,
      llm: buildLlm('Revised post text without exclamation marks.', {
        isVoiceLevelInstruction: true,
        summary: 'Creator never wants exclamation marks in posts.',
        proposedChange: { voice: { forbiddenPhrases: ['!'] } },
      }),
      contentId: item.id,
      instruction: 'Never use exclamation marks in any of my posts',
      runId: 'test-run',
    });

    expect(learningEvent).not.toBeNull();
    expect(learningEvent?.source).toBe('user_instruction');
    expect(learningEvent?.strength).toBe('very_strong');
    expect(learningEvent?.appliedToDna).toBe(false);

    const dnaRows = await pool.query<{ count: string }>('SELECT COUNT(*) FROM content_dna WHERE status = $1', [
      'active',
    ]);
    expect(dnaRows.rows[0]?.count).toBe('1'); // still just the one DNA version from beforeAll — unchanged
  });

  it('throws ContentItemNotFoundError for an unknown content id', async () => {
    await expect(
      reviseLinkedinPost({
        pool,
        llm: buildLlm('irrelevant'),
        contentId: '00000000-0000-0000-0000-000000000099',
        instruction: 'anything',
        runId: 'test-run',
      }),
    ).rejects.toBeInstanceOf(ContentItemNotFoundError);
  });
});
