import { describe, expect, it } from 'vitest';

import { BlogPackageSchema } from './blogPackage.js';

const base = {
  contentId: '11111111-1111-4111-8111-111111111111',
  status: 'in_review' as const,
  title: 'Why UPI Fees Are About To Change',
  slug: 'why-upi-fees-are-about-to-change',
  category: 'Personal Finance',
  metaDescription: 'A look at the RBI UPI fee proposal.',
  deck: 'What the proposal actually changes.',
  estimatedReadTime: '5 min',
  sources: [],
  articleSummary: 'Summary.',
  htmlFile: '<article></article>',
  qaStatus: 'PASS',
  factCheckStatus: 'verified',
  seoStatus: 'ok',
  styleMatchStatus: 'ok',
  contentDnaVersion: 1,
  approvalRequired: true as const,
  publishAction: 'none' as const,
};

describe('BlogPackageSchema', () => {
  it('accepts a valid package', () => {
    expect(BlogPackageSchema.safeParse(base).success).toBe(true);
  });

  it('rejects approvalRequired: false', () => {
    expect(BlogPackageSchema.safeParse({ ...base, approvalRequired: false }).success).toBe(false);
  });
});
