import { describe, expect, it } from 'vitest';

import { QaResultSchema } from './qa.js';

const pass = { status: 'PASS' as const, notes: 'ok' };

describe('QaResultSchema', () => {
  it('accepts a fully-passing result', () => {
    const result = QaResultSchema.safeParse({
      overallStatus: 'PASS',
      claimIntegrity: pass,
      sourceIntegrity: pass,
      voiceMatch: pass,
      originality: pass,
      platformFit: pass,
      clarity: pass,
      hookHonesty: pass,
      privacy: pass,
      personalExperience: pass,
      editability: pass,
      approvalState: pass,
      publishing: pass,
      riskFlags: [],
      requiredUserActions: [],
      publishAllowed: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown overallStatus', () => {
    const result = QaResultSchema.safeParse({
      overallStatus: 'MAYBE',
      claimIntegrity: pass,
      sourceIntegrity: pass,
      voiceMatch: pass,
      originality: pass,
      platformFit: pass,
      clarity: pass,
      hookHonesty: pass,
      privacy: pass,
      personalExperience: pass,
      editability: pass,
      approvalState: pass,
      publishing: pass,
      publishAllowed: false,
    });
    expect(result.success).toBe(false);
  });
});
