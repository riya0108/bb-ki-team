import { describe, expect, it } from 'vitest';

import { YoutubeShortPackageSchema } from './youtubeShortPackage.js';

const base = {
  contentId: '11111111-1111-4111-8111-111111111111',
  status: 'in_review' as const,
  topic: 'UPI fees',
  corePromise: 'Learn who actually pays UPI fees.',
  hookOptions: ['hook 1'],
  titleOptions: ['title 1'],
  spokenScript: 'Script text.',
  visualBeats: ['beat 1'],
  onScreenText: [],
  bRoll: [],
  editingPacing: null,
  description: 'Description.',
  sources: [],
  cta: null,
  contentDnaVersion: 1,
  approvalRequired: true as const,
  publishAction: 'none' as const,
};

describe('YoutubeShortPackageSchema', () => {
  it('accepts a valid package', () => {
    expect(YoutubeShortPackageSchema.safeParse(base).success).toBe(true);
  });

  it('rejects approvalRequired: false', () => {
    expect(YoutubeShortPackageSchema.safeParse({ ...base, approvalRequired: false }).success).toBe(false);
  });

  it('rejects an empty visualBeats array', () => {
    expect(YoutubeShortPackageSchema.safeParse({ ...base, visualBeats: [] }).success).toBe(false);
  });
});
