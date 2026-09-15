import { describe, expect, it } from 'vitest';

import { BufferPublishError, tweetIdFromUrl } from './bufferClient.js';

describe('tweetIdFromUrl', () => {
  it('extracts the trailing numeric id from a handle-qualified status url', () => {
    expect(tweetIdFromUrl('https://x.com/bullorbear/status/1234567890')).toBe('1234567890');
  });

  it('extracts the trailing id from the handle-less fallback url', () => {
    expect(tweetIdFromUrl('https://x.com/i/web/status/1234567890')).toBe('1234567890');
  });

  it('throws BufferPublishError when the url is empty', () => {
    expect(() => tweetIdFromUrl('')).toThrow(BufferPublishError);
  });
});
