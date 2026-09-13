import type { ContentStatus } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { IllegalTransitionError, assertTransition, canTransition } from './stateMachine.js';

const ALL_STATUSES: ContentStatus[] = [
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

const LEGAL_EDGES: [ContentStatus, ContentStatus][] = [
  ['idea', 'researched'],
  ['idea', 'draft'],
  ['researched', 'draft'],
  ['draft', 'in_review'],
  ['in_review', 'changes_requested'],
  ['in_review', 'approved'],
  ['in_review', 'rejected'],
  ['changes_requested', 'in_review'],
  ['changes_requested', 'rejected'],
  ['approved', 'in_review'],
  ['approved', 'rejected'],
  ['approved', 'scheduled'],
  ['approved', 'published'],
  ['scheduled', 'published'],
];

describe('canTransition', () => {
  it('allows every legal edge from spec section 0.3 (as scoped to Phase 1)', () => {
    for (const [from, to] of LEGAL_EDGES) {
      expect(canTransition(from, to), `${from} -> ${to} should be legal`).toBe(true);
    }
  });

  it('rejects every pair not explicitly listed as legal', () => {
    const legalSet = new Set(LEGAL_EDGES.map(([from, to]) => `${from}->${to}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        const expected = legalSet.has(`${from}->${to}`);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('has no outgoing edges from the truly terminal states', () => {
    // scheduled is excluded here: it has exactly one legal edge, to published
    // (spec 0.3: "SCHEDULED ... Yes, at scheduled time" it becomes published).
    for (const terminal of ['published', 'rejected'] as ContentStatus[]) {
      for (const to of ALL_STATUSES) {
        if (to === terminal) continue;
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });

  it('scheduled can only ever advance to published', () => {
    for (const to of ALL_STATUSES) {
      const expected = to === 'published';
      expect(canTransition('scheduled', to)).toBe(expected);
    }
  });
});

describe('assertTransition', () => {
  it('is a no-op for a same-state "transition"', () => {
    expect(() => assertTransition('draft', 'draft')).not.toThrow();
  });

  it('throws IllegalTransitionError for an illegal move', () => {
    expect(() => assertTransition('draft', 'approved')).toThrow(IllegalTransitionError);
  });

  it('does not throw for a legal move', () => {
    expect(() => assertTransition('in_review', 'approved')).not.toThrow();
  });
});
