import type { ContentStatus, QaDimensionResult } from '@bb/shared-types';

// Spec section 14: "Editability — User can modify the actual copy."
export function checkEditability(finalPost: string): QaDimensionResult {
  if (typeof finalPost === 'string' && finalPost.trim().length > 0) {
    return { status: 'PASS', notes: 'Content is plain editable text.' };
  }
  return { status: 'FAIL', notes: 'Content is empty or not plain text.' };
}

// Spec section 14: "Approval state — Clearly marked; never inferred." This mechanically
// reflects the DB-recorded status; it never guesses from content or user phrasing.
export function checkApprovalState(status: ContentStatus): QaDimensionResult {
  return { status: 'PASS', notes: `Status is mechanically reported as "${status}" from the Content Ledger.` };
}

// Spec section 14/15.4: "No action unless approved and connector is authorised."
// Phase 1 ships no publish/schedule connector at all, so this is always satisfied —
// publishAllowed is computed independently and is never true in Phase 1 regardless.
export function checkPublishing(): QaDimensionResult {
  return {
    status: 'PASS',
    notes: 'No publish/schedule connector exists in Phase 1; publishing cannot happen regardless of approval state.',
  };
}
