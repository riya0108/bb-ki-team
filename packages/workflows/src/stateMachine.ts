import type { ContentStatus } from '@bb/shared-types';

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: ContentStatus,
    public readonly to: ContentStatus,
  ) {
    super(`Illegal content status transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

// The 9-state lifecycle from spec section 0.3, restricted to the edges Phase 1's
// ledger functions actually exercise. scheduled/published stay unreachable until
// Phase 3 ships a publish connector — see spec 15.4 ("never publish without an
// authorised connector").
const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  idea: ['researched', 'draft'],
  researched: ['draft'],
  draft: ['in_review'],
  in_review: ['changes_requested', 'approved', 'rejected'],
  // Any edit to a changes_requested or approved item resubmits it for review
  // (spec 15.2's "editing an approved post invalidates approval and returns it
  // to review", generalized to changes_requested for the same reason: edited
  // text always needs fresh eyes before it can be approved).
  changes_requested: ['in_review', 'rejected'],
  approved: ['in_review', 'rejected'],
  scheduled: [],
  published: [],
  rejected: [],
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ContentStatus, to: ContentStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
