import { describe, expect, it } from 'vitest';

import { VisualAssetSchema } from './visualAsset.js';

const notRequired = {
  id: '11111111-1111-4111-8111-111111111111',
  contentId: '22222222-2222-4222-8222-222222222222',
  version: 1,
  status: 'NOT_REQUIRED' as const,
  visualDecision: null,
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

describe('VisualAssetSchema', () => {
  it('accepts a NOT_REQUIRED asset with every optional field null/empty', () => {
    expect(VisualAssetSchema.safeParse(notRequired).success).toBe(true);
  });

  it('accepts a fully populated GENERATED asset', () => {
    const full = {
      ...notRequired,
      status: 'QA_PASS' as const,
      visualDecision: 'RECOMMENDED' as const,
      visualType: 'editorial_photo' as const,
      concept: 'A trader staring at a falling chart',
      rationale: 'Shows consequence, not just data',
      sourceMode: 'ai_generated' as const,
      isAiGenerated: true,
      isIllustrative: true,
      disclosureRequired: true,
      generationBrief: {
        subject: 'a trader',
        secondarySubjects: [],
        action: 'staring at a screen',
        environment: 'a dim trading floor',
        emotion: 'concern',
        composition: 'rule of thirds',
        camera: 'medium shot',
        lens: '50mm',
        lighting: 'low key',
        depthOfField: 'shallow',
        style: 'editorial photography',
        aspectRatio: '4:5',
        textOnImage: 'none',
        negativeConstraints: ['no logos'],
      },
      visualClaims: [
        { claim: 'markets fell today', claimType: 'verified_fact' as const, sourceIds: ['src-1'] },
      ],
      qa: {
        status: 'NEEDS_REVIEW' as const,
        truthIntegrity: 'PASS' as const,
        evidenceIntegrity: 'PASS' as const,
        identityPrivacy: 'PASS' as const,
        visualQuality: 'NEEDS_REVIEW' as const,
        editorialFit: 'PASS' as const,
        platformFit: 'PASS' as const,
        issues: [],
        requiredFixes: [],
        reviewerNotes: 'Automated checks passed; a human must still look at the actual pixels.',
      },
      masterAsset: {
        status: 'STORED' as const,
        provider: 'gemini',
        model: 'gemini-2.5-flash-image',
        generationId: 'gen-123',
        assetPath: '2026/09/22222222-2222-4222-8222-222222222222/master.png',
        assetUrl: 'https://example.supabase.co/storage/v1/object/public/visual-assets/master.png',
        mimeType: 'image/png',
        width: 1024,
        height: 1280,
        createdAt: '2026-09-23T00:00:00.000Z',
      },
    };
    expect(VisualAssetSchema.safeParse(full).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(VisualAssetSchema.safeParse({ ...notRequired, status: 'DONE' }).success).toBe(false);
  });
});
