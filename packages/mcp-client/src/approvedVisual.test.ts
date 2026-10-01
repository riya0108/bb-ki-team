import type { Queryable } from '@bb/db';
import type { VisualAsset } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { VisualPendingReviewError, resolveApprovedVisual } from './approvedVisual.js';

const contentId = '22222222-2222-4222-8222-222222222222';

function visual(overrides: Partial<VisualAsset>): VisualAsset {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    contentId,
    version: 2,
    status: 'APPROVED',
    visualDecision: 'RECOMMENDED',
    visualType: 'illustration',
    concept: 'A shuttered shop front',
    rationale: 'Shows the consequence',
    sourceMode: 'ai_generated',
    isAiGenerated: true,
    isIllustrative: true,
    disclosureRequired: true,
    generationBrief: null,
    visualClaims: [],
    fictionalOrIllustrativeElements: [],
    riskFlags: [],
    qa: null,
    masterAsset: {
      status: 'STORED',
      provider: 'chatgpt-web',
      model: 'chatgpt-web',
      generationId: 'manual:1',
      assetPath: 'a/b/master.png',
      assetUrl: 'https://example.supabase.co/master.png',
      mimeType: 'image/png',
      width: null,
      height: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    platformVariants: {},
    blockingReasons: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

// Fakes the single latest-visual SELECT resolveApprovedVisual issues, so the test
// pins the gate's behavior without a database.
function poolReturning(asset: VisualAsset | null): Queryable {
  const rows = asset
    ? [{ content_id: contentId, version: asset.version, status: asset.status, asset }]
    : [];
  const query = (() => Promise.resolve({ rows })) as unknown as Queryable['query'];
  return { query };
}

describe('resolveApprovedVisual', () => {
  it('returns null when the content has no visual', async () => {
    expect(await resolveApprovedVisual(poolReturning(null), contentId)).toBeNull();
  });

  it('returns an approved, stored visual even when it predates the approved text version', async () => {
    // Visual approved for v2, then a text-only edit produced the approved v3 — the
    // image must still ship (previously dropped silently).
    const approved = visual({ version: 2 });
    const result = await resolveApprovedVisual(poolReturning(approved), contentId);
    expect(result?.masterAsset.assetUrl).toBe(approved.masterAsset.assetUrl);
  });

  it('throws when the latest visual is still awaiting human review', async () => {
    await expect(
      resolveApprovedVisual(poolReturning(visual({ status: 'NEEDS_REVIEW' })), contentId),
    ).rejects.toBeInstanceOf(VisualPendingReviewError);
  });

  it('returns null for a rejected visual so the post goes out text-only', async () => {
    expect(
      await resolveApprovedVisual(poolReturning(visual({ status: 'REJECTED' })), contentId),
    ).toBeNull();
  });
});
