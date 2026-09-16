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

// The 9-state lifecycle from spec section 0.3. approved -> scheduled/published opened
// up in Phase 3 alongside packages/workflows/src/publishing.ts's approval-gated
// requestPublish/requestSchedule — those functions are the only callers, and they
// re-check status === 'approved' themselves before ever attempting a transition, so
// this being reachable in the state graph does not by itself relax spec 15.4's "never
// publish without an authorised connector" (there still is none by default).
const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  idea: ['researched', 'draft'],
  researched: ['draft'],
  draft: ['in_review'],
  in_review: ['changes_requested', 'approved', 'rejected'],
  // Any edit to a changes_requested, approved, or scheduled item resubmits it for
  // review (spec 15.2's "editing an approved post invalidates approval and returns
  // it to review", generalized to changes_requested/scheduled for the same reason:
  // edited text always needs fresh eyes before it can be approved, and a pending
  // schedule can never be allowed to fire the pre-edit text — see addRevision's
  // needsReReview in ledger.ts).
  changes_requested: ['in_review', 'rejected'],
  approved: ['in_review', 'rejected', 'scheduled', 'published'],
  // 'approved' is a human cancelling a pending schedule (packages/workflows/src/
  // publishing.ts's cancelSchedule) without touching the content itself — distinct
  // from 'in_review', which is what an edit to a scheduled item forces instead.
  scheduled: ['published', 'approved', 'in_review'],
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
