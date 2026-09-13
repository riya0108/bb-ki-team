import { describe, expect, it } from 'vitest';

import { InsufficientDistinctTopicsError } from './errors.js';
import type { CandidateTopic } from './sourceDiscovery.js';
import { selectDistinctTopics } from './sourceDiscovery.js';

function candidate(overrides: Partial<CandidateTopic>): CandidateTopic {
  return {
    sourceUrl: 'https://example.com/a',
    topic: 'UPI adoption',
    coreClaim: null,
    angle: 'default angle',
    relevanceScore: 0.5,
    riskLevel: 'low',
    ...overrides,
  };
}

describe('selectDistinctTopics', () => {
  it('picks the top N candidates by relevance once deduped by normalized topic', () => {
    const candidates = [
      candidate({ topic: 'UPI adoption', relevanceScore: 0.4 }),
      candidate({ topic: 'upi ADOPTION', relevanceScore: 0.9 }), // dup of above, higher score wins
      candidate({ topic: 'AI hiring', relevanceScore: 0.8 }),
      candidate({ topic: 'Startup layoffs', relevanceScore: 0.2 }),
    ];

    const selected = selectDistinctTopics(candidates, 2);

    expect(selected).toHaveLength(2);
    expect(selected[0]?.topic).toBe('upi ADOPTION');
    expect(selected[0]?.relevanceScore).toBe(0.9);
    expect(selected[1]?.topic).toBe('AI hiring');
  });

  it('throws InsufficientDistinctTopicsError when fewer than N distinct topics exist', () => {
    const candidates = [
      candidate({ topic: 'UPI adoption', relevanceScore: 0.4 }),
      candidate({ topic: 'upi adoption', relevanceScore: 0.9 }),
    ];

    expect(() => selectDistinctTopics(candidates, 2)).toThrow(InsufficientDistinctTopicsError);
  });

  it('throws when there are no candidates at all', () => {
    expect(() => selectDistinctTopics([], 2)).toThrow(InsufficientDistinctTopicsError);
  });
});
