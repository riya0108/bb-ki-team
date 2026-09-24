import './testing/loadTestEnv.js';

import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertApproval } from './repositories/approvals.js';
import { insertContentDna } from './repositories/contentDna.js';
import { insertContentItem, updateContentItemText } from './repositories/contentItems.js';
import {
  createInterviewSession,
  recordAnswerAndNextQuestion,
} from './repositories/interviewSessions.js';
import { insertLearningEvent } from './repositories/learningEvents.js';
import { insertQaResult } from './repositories/qaResults.js';
import { insertRevision } from './repositories/revisions.js';
import { insertSource } from './repositories/sources.js';
import { getLatestVisualAssetForContent, upsertVisualAsset } from './repositories/visualAssets.js';
import { createPool } from './pool.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const dnaBody = {
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: ['AI'], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
};

describeIfDb('packages/db repositories (integration, real Postgres)', () => {
  const pool = createPool(databaseUrl ?? '');
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
  });

  afterAll(async () => {
    client.release();
    await pool.end();
  });

  // Every test runs inside a transaction that's rolled back afterward, so the
  // integration suite never leaves rows behind in the shared local database.
  async function withRollback(fn: (db: PoolClient) => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await fn(client);
    } finally {
      await client.query('ROLLBACK');
    }
  }

  it('inserts and reads back a content_dna row', async () => {
    await withRollback(async (db) => {
      const dna = await insertContentDna(db, { version: 1, status: 'active', body: dnaBody });
      expect(dna.version).toBe(1);
      expect(dna.identity.role).toBe('Founder');
      expect(dna.status).toBe('active');
    });
  });

  it('inserts a source', async () => {
    await withRollback(async (db) => {
      const source = await insertSource(db, {
        name: 'Test Source',
        platform: 'linkedin',
        url: 'https://example.com/x',
      });
      expect(source.status).toBe('active');
      expect(source.tier).toBe('tier_2_secondary');
    });
  });

  it('creates a content item, revises it, approves it, and QA-gates it', async () => {
    await withRollback(async (db) => {
      const dna = await insertContentDna(db, { version: 1, status: 'active', body: dnaBody });

      const item = await insertContentItem(db, {
        platform: 'x',
        createdByAgent: 'agent-x',
        mode: 'thread',
        topic: 'AI regulation',
        contentDnaVersion: dna.version,
        text: 'first draft',
        package: { threadPosts: ['first draft'] },
      });
      expect(item.currentVersion).toBe(1);
      expect(item.status).toBe('draft');
      expect(item.package).toEqual({ threadPosts: ['first draft'] });

      const revision = await insertRevision(db, item.id, 2, item.currentText, {
        changeType: 'user_edit',
        newText: 'edited draft',
        changedBy: 'user',
      });
      const updated = await updateContentItemText(db, item.id, {
        version: 2,
        text: 'edited draft',
        package: { threadPosts: ['edited draft', 'second post'] },
      });
      expect(updated.currentVersion).toBe(2);
      expect(updated.currentText).toBe('edited draft');
      expect(updated.package).toEqual({ threadPosts: ['edited draft', 'second post'] });
      expect(revision.approvalInvalidated).toBe(false);

      // Omitting `package` entirely (vs. passing null) must leave the existing value
      // alone — this is what lets plain text-only edits skip re-supplying the package.
      const unchanged = await updateContentItemText(db, item.id, {
        version: 3,
        text: 'edited again',
      });
      expect(unchanged.package).toEqual({ threadPosts: ['edited draft', 'second post'] });

      const approval = await insertApproval(db, {
        contentId: item.id,
        version: 2,
        approvedBy: 'riya',
      });
      expect(approval.invalidatedAt).toBeNull();

      const qa = await insertQaResult(db, item.id, 2, {
        overallStatus: 'PASS',
        claimIntegrity: { status: 'PASS', notes: 'ok' },
        sourceIntegrity: { status: 'PASS', notes: 'ok' },
        voiceMatch: { status: 'PASS', notes: 'ok' },
        originality: { status: 'PASS', notes: 'ok' },
        platformFit: { status: 'PASS', notes: 'ok' },
        clarity: { status: 'PASS', notes: 'ok' },
        hookHonesty: { status: 'PASS', notes: 'ok' },
        privacy: { status: 'PASS', notes: 'ok' },
        personalExperience: { status: 'PASS', notes: 'ok' },
        editability: { status: 'PASS', notes: 'ok' },
        approvalState: { status: 'PASS', notes: 'ok' },
        publishing: { status: 'PASS', notes: 'ok' },
        riskFlags: [],
        requiredUserActions: [],
        publishAllowed: false,
      });
      expect(qa.result.overallStatus).toBe('PASS');
      expect(qa.result.publishAllowed).toBe(false);
    });
  });

  it('records a learning event', async () => {
    await withRollback(async (db) => {
      const event = await insertLearningEvent(db, {
        source: 'user_instruction',
        observation: 'always use short sentences',
        strength: 'very_strong',
      });
      expect(event.appliedToDna).toBe(false);
      expect(event.strength).toBe('very_strong');
    });
  });

  it('runs a two-turn interview session to completion', async () => {
    await withRollback(async (db) => {
      const session = await createInterviewSession(db, 'AI regulation', 'What changed recently?');
      expect(session.turns).toHaveLength(1);

      const afterAnswer = await recordAnswerAndNextQuestion(db, session.id, {
        answer: 'A new bill was proposed.',
        nextQuestion: 'Who does it affect most?',
      });
      expect(afterAnswer.turns).toHaveLength(2);
      expect(afterAnswer.status).toBe('active');

      const completed = await recordAnswerAndNextQuestion(db, session.id, {
        answer: 'Small fintech startups.',
        nextQuestion: null,
      });
      expect(completed.status).toBe('completed');
      expect(completed.turns).toHaveLength(2);
      expect(completed.turns[1]?.answer).toBe('Small fintech startups.');
    });
  });

  it('stores and re-fetches a visual asset, upserting in place for the same version', async () => {
    await withRollback(async (db) => {
      const dna = await insertContentDna(db, { version: 1, status: 'active', body: dnaBody });
      const item = await insertContentItem(db, {
        platform: 'instagram',
        createdByAgent: 'agent-instagram',
        mode: 'single_topic',
        topic: 'AI regulation',
        contentDnaVersion: dna.version,
        text: 'a post about AI regulation',
      });

      const base = {
        id: '11111111-1111-4111-8111-111111111111',
        contentId: item.id,
        version: 1,
        visualType: null,
        concept: null,
        rationale: null,
        sourceMode: null,
        isAiGenerated: false,
        isIllustrative: false,
        disclosureRequired: false,
        generationBrief: null,
        visualClaims: [],
        fictionalOrIllustrativeElements: [],
        riskFlags: [],
        qa: null,
        masterAsset: {
          status: 'NONE' as const,
          provider: null,
          model: null,
          generationId: null,
          assetPath: null,
          assetUrl: null,
          mimeType: null,
          width: null,
          height: null,
          createdAt: null,
        },
        platformVariants: {},
        blockingReasons: [],
        createdAt: '2026-09-23T00:00:00.000Z',
        updatedAt: '2026-09-23T00:00:00.000Z',
      };

      const pending = await upsertVisualAsset(db, {
        ...base,
        status: 'GENERATION_PENDING',
        visualDecision: 'RECOMMENDED',
      });
      expect(pending.status).toBe('GENERATION_PENDING');

      const failed = await upsertVisualAsset(db, {
        ...base,
        status: 'FAILED',
        visualDecision: 'RECOMMENDED',
        blockingReasons: ['provider returned no asset'],
      });
      expect(failed.status).toBe('FAILED');

      const latest = await getLatestVisualAssetForContent(db, item.id);
      expect(latest?.status).toBe('FAILED');
      expect(latest?.blockingReasons).toEqual(['provider returned no asset']);
    });
  });
});
