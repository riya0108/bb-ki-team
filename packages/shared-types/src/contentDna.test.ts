import { describe, expect, it } from 'vitest';

import { ContentDnaDraftSchema, ContentDnaRecordSchema } from './contentDna.js';

const validBody = {
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: ['AI'], secondary: [], avoid: ['politics'] },
  opinions: { stronglyHeld: ['x'], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
};

describe('ContentDnaRecordSchema', () => {
  it('accepts a fully populated active version', () => {
    const result = ContentDnaRecordSchema.safeParse({
      ...validBody,
      id: '11111111-1111-4111-8111-111111111111',
      version: 1,
      status: 'active',
      createdAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      confirmedBy: 'riya',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a record missing identity.role', () => {
    const { identity: _identity, ...rest } = validBody;
    const result = ContentDnaRecordSchema.safeParse({
      ...rest,
      identity: { expertise: [], audiencePrimary: 'x' },
      id: '11111111-1111-4111-8111-111111111111',
      version: 1,
      status: 'active',
      createdAt: new Date().toISOString(),
      confirmedAt: null,
      confirmedBy: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid status', () => {
    const result = ContentDnaRecordSchema.safeParse({
      ...validBody,
      id: '11111111-1111-4111-8111-111111111111',
      version: 1,
      status: 'published', // not a DNA status
      createdAt: new Date().toISOString(),
      confirmedAt: null,
      confirmedBy: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('ContentDnaDraftSchema', () => {
  it('accepts a mostly-empty draft with only pending questions', () => {
    const result = ContentDnaDraftSchema.safeParse({
      pendingQuestions: ['What is your primary audience?'],
    });
    expect(result.success).toBe(true);
  });
});
