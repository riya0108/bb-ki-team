import { createFakeLlmClient } from '@bb/core/testing';
import { describe, expect, it } from 'vitest';

import { decideAndBrief } from './decideAndBrief.js';

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
  fictionalOrIllustrativeElements: [
    'the specific trader shown is a generic illustration, not a real person',
  ],
  riskFlags: [],
};

const baseInput = {
  contentId: 'content-1',
  platform: 'instagram',
  topic: 'market volatility',
  coreClaim: 'Markets fell sharply today',
  currentText: "A post about today's market drop.",
  sourceUrls: ['https://example.com/markets'],
  runId: 'run-1',
  stepId: 'step-1',
};

describe('decideAndBrief', () => {
  it('returns a fully-shaped decision for a normal editorial story', async () => {
    const llm = createFakeLlmClient(() => JSON.stringify(briefResponse));
    const result = await decideAndBrief({ ...baseInput, llm });

    expect(result.visualDecision).toBe('RECOMMENDED');
    expect(result.generationBrief.aspectRatio).toBe('4:5');
    expect(result.visualClaims[0]?.claimType).toBe('verified_fact');
  });

  it('propagates REAL_ASSET_REQUIRED when the model decides a real source artifact is needed', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        ...briefResponse,
        visualDecision: 'REAL_ASSET_REQUIRED',
        sourceMode: 'real_sourced_asset',
      }),
    );
    const result = await decideAndBrief({ ...baseInput, llm });
    expect(result.visualDecision).toBe('REAL_ASSET_REQUIRED');
  });

  it('rejects a malformed response missing required generationBrief fields', async () => {
    const llm = createFakeLlmClient((_input, callIndex) =>
      // completeStructured retries once with a repair instruction — keep failing
      // both times so the malformed-output path is exercised end to end.
      callIndex < 2
        ? JSON.stringify({ visualDecision: 'RECOMMENDED' })
        : JSON.stringify({ visualDecision: 'RECOMMENDED' }),
    );
    await expect(decideAndBrief({ ...baseInput, llm })).rejects.toThrow();
  });
});
