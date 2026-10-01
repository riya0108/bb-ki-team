try {
  process.loadEnvFile();
} catch {
  // no .env file present — the describeIfDb guard below skips these tests.
}

import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import {
  getContentItemById,
  insertApproval,
  insertContentDna,
  insertContentItem,
  insertQaResult,
  setContentItemApproval,
} from '@bb/db';
import { createPool } from '@bb/db';
import { createImageGenMcpClient } from '@bb/mcp-client';
import type { GeneratedImage, ImageGenTool, StoredVisualAsset } from '@bb/mcp-client';

import { VisualBlockedMissingTruthLayerError, VisualContentNotFoundError } from './errors.js';
import { VisualBriefNotPendingError, ingestManualVisualAsset } from './ingestManualVisualAsset.js';
import { prepareVisualBrief } from './prepareVisualBrief.js';
import { runVisualStage } from './runVisualStage.js';
import { uploadUserVisualAsset } from './uploadUserVisualAsset.js';

const noopLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

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

const passingQaResult = {
  overallStatus: 'PASS' as const,
  claimIntegrity: { status: 'PASS' as const, notes: 'ok' },
  sourceIntegrity: { status: 'PASS' as const, notes: 'ok' },
  voiceMatch: { status: 'PASS' as const, notes: 'ok' },
  originality: { status: 'PASS' as const, notes: 'ok' },
  platformFit: { status: 'PASS' as const, notes: 'ok' },
  clarity: { status: 'PASS' as const, notes: 'ok' },
  hookHonesty: { status: 'PASS' as const, notes: 'ok' },
  privacy: { status: 'PASS' as const, notes: 'ok' },
  personalExperience: { status: 'PASS' as const, notes: 'ok' },
  editability: { status: 'PASS' as const, notes: 'ok' },
  approvalState: { status: 'PASS' as const, notes: 'ok' },
  publishing: { status: 'PASS' as const, notes: 'ok' },
  riskFlags: [],
  requiredUserActions: [],
  publishAllowed: false,
};

const briefResponse = {
  visualDecision: 'RECOMMENDED',
  visualType: 'editorial_photo',
  concept: 'A trader watching a falling chart',
  rationale: 'Shows the consequence, not just the number',
  sourceMode: 'ai_generated',
  isIllustrative: true,
  disclosureRequired: true,
  generationBrief: {
    subject: 'a trader',
    secondarySubjects: [],
    action: 'staring at a falling chart',
    environment: 'a trading floor',
    emotion: 'concern',
    composition: 'rule of thirds',
    camera: 'medium shot',
    lens: null,
    lighting: 'low key',
    depthOfField: null,
    style: 'editorial photography',
    aspectRatio: '4:5',
    textOnImage: 'none',
    negativeConstraints: [],
  },
  visualClaims: [{ claim: 'markets fell today', claimType: 'verified_fact', sourceIds: ['src-1'] }],
  fictionalOrIllustrativeElements: ['generic illustration, not a real person'],
  riskFlags: [],
};

const passingQaJudgment = {
  truthIntegrity: 'PASS',
  evidenceIntegrity: 'PASS',
  identityPrivacy: 'PASS',
  editorialFit: 'PASS',
  platformFit: 'PASS',
  issues: [],
  requiredFixes: [],
  reviewerNotes: 'ok',
};

function llmFor(
  decision: Record<string, unknown>,
  qaJudgment: Record<string, unknown> = passingQaJudgment,
) {
  return createFakeLlmClient((input) =>
    input.system?.includes('visual QA reviewer')
      ? JSON.stringify(qaJudgment)
      : JSON.stringify(decision),
  );
}

const fakeGeneratedImage: GeneratedImage = {
  provider: 'gemini',
  model: 'gemini-2.5-flash-image',
  generationId: 'gen-1',
  base64Data: 'ZmFrZQ==',
  mimeType: 'image/png',
};

const fakeStoredAsset: StoredVisualAsset = {
  assetPath: '2026/09/content/visual/master.png',
  assetUrl: 'https://example.supabase.co/storage/v1/object/sign/visual-assets/master.png?token=x',
};

function fakeImageGen(overrides: Partial<ImageGenTool> = {}): ImageGenTool {
  return {
    generateImage: () => Promise.resolve(fakeGeneratedImage),
    storeVisualAsset: () => Promise.resolve(fakeStoredAsset),
    signAsset: () => Promise.resolve({ assetUrl: fakeStoredAsset.assetUrl }),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

describeIfDb('runVisualStage (integration, real Postgres)', () => {
  const pool = createPool(databaseUrl ?? '');
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
  });

  afterAll(async () => {
    client.release();
    await pool.end();
  });

  async function withRollback(fn: (db: PoolClient) => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await fn(client);
    } finally {
      await client.query('ROLLBACK');
    }
  }

  async function seedContentItem(db: PoolClient) {
    const dna = await insertContentDna(db, {
      version: Date.now() % 1_000_000,
      status: 'active',
      body: dnaBody,
    });
    return insertContentItem(db, {
      platform: 'instagram',
      createdByAgent: 'agent-instagram',
      mode: 'single_topic',
      topic: 'market volatility',
      coreClaim: 'Markets fell sharply today',
      contentDnaVersion: dna.version,
      text: 'A post about the market drop.',
    });
  }

  it('T02 visual-enabled happy path: generates, stores, and lands in NEEDS_REVIEW', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);

      const asset = await runVisualStage({
        contentId: item.id,
        pool: db,
        llm: llmFor(briefResponse),
        imageGen: fakeImageGen(),
        runId: 'run-1',
      });

      expect(asset.status).toBe('NEEDS_REVIEW');
      expect(asset.masterAsset.status).toBe('STORED');
      expect(asset.masterAsset.assetUrl).toBe(fakeStoredAsset.assetUrl);
      expect(asset.qa?.visualQuality).toBe('NEEDS_REVIEW');
    });
  });

  it('T03 provider failure: never fakes success, records FAILED with the real reason', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);

      const asset = await runVisualStage({
        contentId: item.id,
        pool: db,
        llm: llmFor(briefResponse),
        imageGen: fakeImageGen({
          generateImage: () => Promise.reject(new Error('provider quota exceeded')),
        }),
        runId: 'run-1',
      });

      expect(asset.status).toBe('FAILED');
      expect(asset.masterAsset.status).toBe('NONE');
      expect(asset.blockingReasons[0]).toContain('provider quota exceeded');
    });
  });

  it('T04 visual QA failure: rejects fabricated evidence without ever storing the asset', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);
      let storeCalled = false;

      const asset = await runVisualStage({
        contentId: item.id,
        pool: db,
        llm: llmFor(briefResponse, {
          ...passingQaJudgment,
          evidenceIntegrity: 'FAIL',
          issues: ['fake government notice'],
        }),
        imageGen: fakeImageGen({
          storeVisualAsset: () => {
            storeCalled = true;
            return Promise.resolve(fakeStoredAsset);
          },
        }),
        runId: 'run-1',
      });

      expect(asset.status).toBe('REJECTED');
      expect(storeCalled).toBe(false);
      expect(asset.masterAsset.status).toBe('NONE');
    });
  });

  it('T05 post-approval visual change invalidates the existing approval', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);
      await insertApproval(db, {
        contentId: item.id,
        version: item.currentVersion,
        approvedBy: 'riya',
      });
      const approved = await setContentItemApproval(db, item.id, {
        version: item.currentVersion,
        approvedBy: 'riya',
      });
      expect(approved.status).toBe('approved');

      await runVisualStage({
        contentId: item.id,
        pool: db,
        llm: llmFor(briefResponse),
        imageGen: fakeImageGen(),
        runId: 'run-1',
      });

      const after = await getContentItemById(db, item.id);
      expect(after?.status).toBe('in_review');
      expect(after?.approvedVersion).toBeNull();
    });
  });

  it('T06 high-risk content is flagged in qa.issues', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);

      const asset = await runVisualStage({
        contentId: item.id,
        pool: db,
        llm: llmFor({
          ...briefResponse,
          concept: 'A minister announcing new government policy on stock market returns',
        }),
        imageGen: fakeImageGen(),
        runId: 'run-1',
      });

      expect(asset.qa?.issues.some((issue) => issue.startsWith('high-risk topic:'))).toBe(true);
    });
  });

  it('T07 real-asset-required: never attempts generation, returns BRIEF_READY', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);
      let generateCalled = false;

      const asset = await runVisualStage({
        contentId: item.id,
        pool: db,
        llm: llmFor({
          ...briefResponse,
          visualDecision: 'REAL_ASSET_REQUIRED',
          sourceMode: 'real_sourced_asset',
        }),
        imageGen: fakeImageGen({
          generateImage: () => {
            generateCalled = true;
            return Promise.resolve(fakeGeneratedImage);
          },
        }),
        runId: 'run-1',
      });

      expect(asset.status).toBe('BRIEF_READY');
      expect(generateCalled).toBe(false);
      expect(asset.blockingReasons[0]).toContain('REAL_ASSET_REQUIRED');
    });
  });

  it('T08 no-provider: the real MCP client (no config) fails honestly, never fakes success', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);

      const realClientWithNoConfig = createImageGenMcpClient({}, noopLogger);

      const asset = await runVisualStage({
        contentId: item.id,
        pool: db,
        llm: llmFor(briefResponse),
        imageGen: realClientWithNoConfig,
        runId: 'run-1',
      });

      expect(asset.status).toBe('FAILED');
      expect(asset.blockingReasons[0]).toContain('no image provider is configured');
      await realClientWithNoConfig.close();
    });
  });

  it('throws VISUAL_BLOCKED_MISSING_TRUTH_LAYER when neither coreClaim nor a QA result exists', async () => {
    await withRollback(async (db) => {
      const dna = await insertContentDna(db, {
        version: Date.now() % 1_000_000,
        status: 'active',
        body: dnaBody,
      });
      const item = await insertContentItem(db, {
        platform: 'instagram',
        createdByAgent: 'agent-instagram',
        mode: 'single_topic',
        contentDnaVersion: dna.version,
        text: 'no core claim, no QA run yet',
      });

      await expect(
        runVisualStage({
          contentId: item.id,
          pool: db,
          llm: llmFor(briefResponse),
          imageGen: fakeImageGen(),
          runId: 'run-1',
        }),
      ).rejects.toBeInstanceOf(VisualBlockedMissingTruthLayerError);
    });
  });

  it('throws VisualContentNotFoundError for an unknown content id', async () => {
    await withRollback(async (db) => {
      await expect(
        runVisualStage({
          contentId: '11111111-1111-4111-8111-111111111111',
          pool: db,
          llm: llmFor(briefResponse),
          imageGen: fakeImageGen(),
          runId: 'run-1',
        }),
      ).rejects.toBeInstanceOf(VisualContentNotFoundError);
    });
  });

  // Browser-driven manual path (see .agents/skills/bb-visual-agent): prepareVisualBrief
  // returns a prompt for a human/Claude to run through ChatGPT/Gemini web/etc, then
  // ingestManualVisualAsset finishes the same QA+storage path runVisualStage uses —
  // proven for real against ChatGPT web + this Supabase project during development.
  it('manual path: prepareVisualBrief + ingestManualVisualAsset reaches NEEDS_REVIEW', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);

      const prepared = await prepareVisualBrief({ contentId: item.id, pool: db, llm: llmFor(briefResponse), runId: 'run-1' });
      expect(prepared.kind).toBe('pending');
      if (prepared.kind !== 'pending') throw new Error('expected pending');
      expect(prepared.prompt.length).toBeGreaterThan(0);

      const asset = await ingestManualVisualAsset({
        contentId: item.id,
        visualId: prepared.visualId,
        pool: db,
        llm: llmFor(briefResponse),
        imageGen: fakeImageGen(),
        runId: 'run-2',
        base64Data: fakeGeneratedImage.base64Data,
        mimeType: 'image/png',
        provider: 'chatgpt-web',
        model: 'chatgpt-web-manual',
      });

      expect(asset.status).toBe('NEEDS_REVIEW');
      expect(asset.masterAsset.provider).toBe('chatgpt-web');
      expect(asset.masterAsset.status).toBe('STORED');
    });
  });

  it('manual path: refuses to ingest when no GENERATION_PENDING brief exists for that visualId', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);

      await expect(
        ingestManualVisualAsset({
          contentId: item.id,
          visualId: '11111111-1111-4111-8111-111111111111',
          pool: db,
          llm: llmFor(briefResponse),
          imageGen: fakeImageGen(),
          runId: 'run-1',
          base64Data: fakeGeneratedImage.base64Data,
          mimeType: 'image/png',
          provider: 'chatgpt-web',
          model: 'chatgpt-web-manual',
        }),
      ).rejects.toBeInstanceOf(VisualBriefNotPendingError);
    });
  });

  it('user upload: stored APPROVED with no QA, no brief, and keeps an existing approval', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertApproval(db, {
        contentId: item.id,
        version: item.currentVersion,
        approvedBy: 'riya',
      });
      await setContentItemApproval(db, item.id, {
        version: item.currentVersion,
        approvedBy: 'riya',
      });

      const asset = await uploadUserVisualAsset({
        contentId: item.id,
        pool: db,
        imageGen: fakeImageGen(),
        base64Data: 'ZmFrZQ==',
        mimeType: 'image/jpeg',
      });

      expect(asset.status).toBe('APPROVED');
      expect(asset.qa).toBeNull();
      expect(asset.sourceMode).toBe('user_supplied_asset');
      expect(asset.masterAsset.assetUrl).toBe(fakeStoredAsset.assetUrl);
      expect(asset.masterAsset.mimeType).toBe('image/jpeg');
      const after = await getContentItemById(db, item.id);
      expect(after?.status).toBe('approved');
    });
  });

  it('user upload: replaces a pending brief for the same version', async () => {
    await withRollback(async (db) => {
      const item = await seedContentItem(db);
      await insertQaResult(db, item.id, item.currentVersion, passingQaResult);
      const prepared = await prepareVisualBrief({
        contentId: item.id,
        pool: db,
        llm: llmFor(briefResponse),
        runId: 'run-1',
      });
      expect(prepared.kind).toBe('pending');

      const asset = await uploadUserVisualAsset({
        contentId: item.id,
        pool: db,
        imageGen: fakeImageGen(),
        base64Data: 'ZmFrZQ==',
        mimeType: 'image/png',
      });

      expect(asset.status).toBe('APPROVED');
      expect(asset.concept).toBe(briefResponse.concept);
    });
  });

  it('user upload: throws VisualContentNotFoundError for an unknown content id', async () => {
    await withRollback(async (db) => {
      await expect(
        uploadUserVisualAsset({
          contentId: '00000000-0000-0000-0000-000000000000',
          pool: db,
          imageGen: fakeImageGen(),
          base64Data: 'ZmFrZQ==',
          mimeType: 'image/png',
        }),
      ).rejects.toBeInstanceOf(VisualContentNotFoundError);
    });
  });
});
