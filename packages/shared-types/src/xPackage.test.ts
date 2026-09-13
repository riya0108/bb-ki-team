import { describe, expect, it } from 'vitest';

import { XPackageSchema } from './xPackage.js';

const base = {
  contentId: '11111111-1111-4111-8111-111111111111',
  status: 'in_review' as const,
  mode: 'single' as const,
  topic: 'AI regulation',
  angle: 'contrarian',
  hookOptions: ['hook 1'],
  finalCopy: 'Final post text.',
  threadPosts: null,
  sourceReferences: [],
  factCheckStatus: 'verified',
  contentDnaVersion: 1,
  approvalRequired: true as const,
  publishAction: 'none' as const,
};

describe('XPackageSchema', () => {
  it('accepts a valid single-post package', () => {
    expect(XPackageSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a valid thread package with threadPosts populated', () => {
    const thread = { ...base, mode: 'thread' as const, threadPosts: ['Post 1', 'Post 2', 'Post 3'] };
    expect(XPackageSchema.safeParse(thread).success).toBe(true);
  });

  it('rejects approvalRequired: false — Phase 2 must never allow this', () => {
    const result = XPackageSchema.safeParse({ ...base, approvalRequired: false });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown mode', () => {
    const result = XPackageSchema.safeParse({ ...base, mode: 'carousel' });
    expect(result.success).toBe(false);
  });
});
