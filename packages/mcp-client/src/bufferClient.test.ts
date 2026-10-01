import { PermanentPublishError } from '@bb/workflows';
import { describe, expect, it } from 'vitest';

import { BufferPublishError, bufferToolError, tweetIdFromUrl } from './bufferClient.js';

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

describe('bufferToolError', () => {
  it("classifies Buffer's duplicate-post rejection as permanent", () => {
    const error = bufferToolError(
      "Invalid post: Whoops, it looks like you've already got this one scheduled or posted around the same time. We're not able to post the same thing twice so close together.",
    );
    expect(error).toBeInstanceOf(PermanentPublishError);
  });

  it('keeps every other Buffer error retryable', () => {
    expect(bufferToolError('Buffer API timed out')).toBeInstanceOf(BufferPublishError);
  });
});
