import { describe, expect, it } from 'vitest';

import { BRAND_BRAIN, CLAIM_TAXONOMY, FORBIDDEN_PHRASES } from './brandBrain.js';

describe('BRAND_BRAIN', () => {
  it('includes all forbidden phrases from spec section 2.3', () => {
    expect(FORBIDDEN_PHRASES).toEqual(
      expect.arrayContaining(['revolutionary', 'game-changing', 'unlock', 'supercharge', 'leverage', 'delve', 'seamless']),
    );
  });

  it('defines all 6 claim taxonomy types from spec section 2.4', () => {
    const types = CLAIM_TAXONOMY.map((c) => c.type);
    expect(types).toEqual(['FACT', 'ATTRIBUTED_CLAIM', 'INTERPRETATION', 'OPINION', 'PREDICTION', 'UNKNOWN']);
  });

  it('mentions the em-dash rule in permanent writing rules', () => {
    expect(BRAND_BRAIN.permanentWritingRules.some((rule) => rule.toLowerCase().includes('em dash'))).toBe(true);
  });
});
