import { describe, expect, it } from 'vitest';

import { LinkedinPackageSchema } from './linkedinPackage.js';

const base = {
  contentId: '11111111-1111-4111-8111-111111111111',
  status: 'in_review' as const,
  mode: 'single_topic' as const,
  topic: 'AI regulation',
  sourceReferences: [],
  angle: 'contrarian',
  hookOptions: ['hook 1'],
  finalPost: 'Final post text.',
  characterCount: 17,
  contentDnaVersion: 1,
  factCheckStatus: 'verified',
  originalityStatus: 'original',
  riskFlags: [],
  visualSuggestion: null,
  firstCommentOptional: null,
  approvalRequired: true as const,
  publishAction: 'none' as const,
  scheduleDetails: null,
};

describe('LinkedinPackageSchema', () => {
  it('accepts a valid in-review package', () => {
    expect(LinkedinPackageSchema.safeParse(base).success).toBe(true);
  });

  it('rejects approvalRequired: false — Phase 1 must never allow this', () => {
    const result = LinkedinPackageSchema.safeParse({ ...base, approvalRequired: false });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown publishAction', () => {
    const result = LinkedinPackageSchema.safeParse({ ...base, publishAction: 'auto_publish' });
    expect(result.success).toBe(false);
  });
});
