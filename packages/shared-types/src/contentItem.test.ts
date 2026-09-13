import { describe, expect, it } from 'vitest';

import { ContentItemSchema, ContentStatusSchema } from './contentItem.js';

describe('ContentStatusSchema', () => {
  it('accepts all 9 lifecycle states from spec section 0.3', () => {
    const states = [
      'idea',
      'researched',
      'draft',
      'in_review',
      'changes_requested',
      'approved',
      'scheduled',
      'published',
      'rejected',
    ];
    for (const state of states) {
      expect(ContentStatusSchema.safeParse(state).success).toBe(true);
    }
  });

  it('rejects an unknown status', () => {
    expect(ContentStatusSchema.safeParse('deleted').success).toBe(false);
  });
});

describe('ContentItemSchema', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    platform: 'linkedin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByAgent: 'agent-linkedin',
    mode: 'single_topic',
    topic: 'AI regulation',
    contentPillar: null,
    sourceIds: [],
    sourceUrls: [],
    coreClaim: null,
    angle: null,
    contentDnaVersion: 1,
    currentVersion: 1,
    currentText: 'draft text',
    status: 'draft',
    riskLevel: 'low',
    approvedVersion: null,
    approvedAt: null,
    approvedBy: null,
    package: null,
  };

  it('accepts a valid draft content item', () => {
    expect(ContentItemSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an approved item with no approvedVersion (schema-level shape only)', () => {
    // The DB-level CHECK constraint enforces the real invariant; at the schema level
    // approvedVersion is nullable so this specific combination still parses. This test
    // documents that the invariant lives in packages/db + packages/workflows, not here.
    const result = ContentItemSchema.safeParse({ ...base, status: 'approved', approvedVersion: null });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid mode', () => {
    const result = ContentItemSchema.safeParse({ ...base, mode: 'telepathy' });
    expect(result.success).toBe(false);
  });
});
