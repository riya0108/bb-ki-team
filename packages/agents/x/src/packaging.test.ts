import { describe, expect, it } from 'vitest';

import type { DraftXOutput } from './draftPost.js';
import { appendHashtags, enforceXLengthLimit } from './packaging.js';
import { X_MAX_POST_LENGTH } from './threadSplit.js';

function draft(overrides: Partial<DraftXOutput>): DraftXOutput {
  return {
    mode: 'single',
    hookOptions: ['hook'],
    finalCopy: 'short post',
    threadPosts: null,
    factCheckStatus: 'ok',
    hashtags: [],
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

describe('appendHashtags', () => {
  it('leaves a draft with no hashtags untouched', () => {
    const input = draft({ hashtags: [] });
    expect(appendHashtags(input)).toBe(input);
  });

  it('appends up to 3 normalized hashtags to a single post', () => {
    const result = appendHashtags(draft({ finalCopy: 'A sharp take.', hashtags: ['Markets', '#Fintech', 'UPI'] }));

    expect(result.finalCopy).toBe('A sharp take.\n\n#Markets #Fintech #UPI');
    expect(result.hashtags).toEqual(['#Markets', '#Fintech', '#UPI']);
  });

  it('dedupes hashtags and caps at 3 regardless of casing/# prefix noise', () => {
    const result = appendHashtags(draft({ finalCopy: 'Post.', hashtags: ['#Markets', 'Markets', 'A', 'B', 'C'] }));
    expect(result.hashtags).toEqual(['#Markets', '#A', '#B']);
  });

  it('appends hashtags only to the first post of a thread, leaving continuations untouched', () => {
    const input = draft({
      mode: 'thread',
      finalCopy: 'first post',
      threadPosts: ['first post', 'second post', 'third post'],
      hashtags: ['Markets', 'Fintech'],
    });
    const result = appendHashtags(input);

    expect(result.finalCopy).toBe('first post\n\n#Markets #Fintech');
    expect(result.threadPosts).toEqual(['first post\n\n#Markets #Fintech', 'second post', 'third post']);
  });

  it('drops hashtags one at a time until the first post fits within the 280-char limit', () => {
    const post = 'A'.repeat(X_MAX_POST_LENGTH - 30);
    const result = appendHashtags(draft({ finalCopy: post, hashtags: ['LongEnoughTagOne', 'LongEnoughTagTwo'] }));

    expect(result.finalCopy.length).toBeLessThanOrEqual(X_MAX_POST_LENGTH);
    expect(result.hashtags).toEqual(['#LongEnoughTagOne']);
  });

  it('omits hashtags entirely when even one does not fit, without truncating the post text', () => {
    const post = 'A'.repeat(X_MAX_POST_LENGTH);
    const result = appendHashtags(draft({ finalCopy: post, hashtags: ['Markets'] }));

    expect(result.finalCopy).toBe(post);
    expect(result.hashtags).toEqual([]);
  });
});
