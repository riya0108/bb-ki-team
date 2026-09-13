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
      candidate({ topic: 'upi ADOPTION', relevanceScore: 0.9 }),
      candidate({ topic: 'AI hiring', relevanceScore: 0.8 }),
    ];

    const selected = selectDistinctTopics(candidates, 1);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.topic).toBe('upi ADOPTION');
  });

  it('throws InsufficientDistinctTopicsError when fewer than N distinct topics exist', () => {
    expect(() => selectDistinctTopics([], 1)).toThrow(InsufficientDistinctTopicsError);
  });
});
