import { describe, expect, it } from 'vitest';

import { splitPostIntoThread, X_MAX_POST_LENGTH } from './threadSplit.js';

describe('splitPostIntoThread', () => {
  it('returns the text unchanged, as a single post, when already within the limit', () => {
    expect(splitPostIntoThread('short post')).toEqual(['short post']);
  });

  it('splits on paragraph breaks and keeps every post within the limit', () => {
    const paragraphs = [
      'A'.repeat(200),
      'B'.repeat(200),
      'C'.repeat(200),
    ];
    const posts = splitPostIntoThread(paragraphs.join('\n\n'));

    expect(posts.length).toBeGreaterThan(1);
    for (const post of posts) expect(post.length).toBeLessThanOrEqual(X_MAX_POST_LENGTH);
    // No paragraph's content is lost, even though it was redistributed across posts.
    for (const paragraph of paragraphs) expect(posts.join('\n\n')).toContain(paragraph);
  });

  it('falls back to sentence splitting when a single paragraph alone exceeds the limit', () => {
    const sentences = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`);
    const posts = splitPostIntoThread(sentences.join(' '));

    expect(posts.length).toBeGreaterThan(1);
    for (const post of posts) expect(post.length).toBeLessThanOrEqual(X_MAX_POST_LENGTH);
    for (const sentence of sentences) expect(posts.join(' ')).toContain(sentence);
  });

  it('falls back to a hard character slice for a single word longer than the limit', () => {
    const posts = splitPostIntoThread('x'.repeat(600));

    expect(posts.length).toBe(3);
    for (const post of posts) expect(post.length).toBeLessThanOrEqual(X_MAX_POST_LENGTH);
    expect(posts.join('')).toBe('x'.repeat(600));
  });
});
