import { describe, expect, it } from 'vitest';

import type { DraftXOutput } from './draftPost.js';
import { enforceXLengthLimit } from './packaging.js';
import { X_MAX_POST_LENGTH } from './threadSplit.js';

function draft(overrides: Partial<DraftXOutput>): DraftXOutput {
  return {
    mode: 'single',
    hookOptions: ['hook'],
    finalCopy: 'short post',
    threadPosts: null,
    factCheckStatus: 'ok',
    ...overrides,
  };
}

describe('enforceXLengthLimit', () => {
  it('leaves a single post within the limit untouched', () => {
    const input = draft({ mode: 'single', finalCopy: 'short post', threadPosts: null });
    expect(enforceXLengthLimit(input)).toBe(input);
  });

  it('leaves a thread whose posts are all within the limit untouched', () => {
    const input = draft({ mode: 'thread', finalCopy: 'first', threadPosts: ['first', 'second'] });
    expect(enforceXLengthLimit(input)).toBe(input);
  });

  it('converts an over-limit single post into a thread instead of leaving it unpublishable', () => {
    const longPost = 'Nobody tells you this.\n\n' + 'A'.repeat(400) + '\n\n' + 'B'.repeat(400);
    const result = enforceXLengthLimit(draft({ mode: 'single', finalCopy: longPost, threadPosts: null }));

    expect(result.mode).toBe('thread');
    expect(result.threadPosts).not.toBeNull();
    expect(result.threadPosts!.length).toBeGreaterThan(1);
    for (const post of result.threadPosts!) expect(post.length).toBeLessThanOrEqual(X_MAX_POST_LENGTH);
    expect(result.finalCopy).toBe(result.threadPosts![0]);
  });

  it('re-splits any individual over-limit post inside an already-threaded draft', () => {
    const oversized = 'C'.repeat(500);
    const result = enforceXLengthLimit(
      draft({ mode: 'thread', finalCopy: 'first post', threadPosts: ['first post', oversized] }),
    );

    expect(result.mode).toBe('thread');
    for (const post of result.threadPosts!) expect(post.length).toBeLessThanOrEqual(X_MAX_POST_LENGTH);
    expect(result.threadPosts![0]).toBe('first post');
    expect(result.threadPosts!.join('')).toContain(oversized.slice(0, X_MAX_POST_LENGTH));
  });
});
