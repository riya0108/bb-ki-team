import { describe, expect, it } from 'vitest';

import { extractYoutubeVideoId } from './videoId.js';

describe('extractYoutubeVideoId', () => {
  it('extracts the id from a standard watch URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=abc123XYZ_9')).toBe('abc123XYZ_9');
  });

  it('extracts the id from a youtu.be short link', () => {
    expect(extractYoutubeVideoId('https://youtu.be/abc123XYZ_9')).toBe('abc123XYZ_9');
  });

  it('extracts the id from a Shorts URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/abc123XYZ_9')).toBe('abc123XYZ_9');
  });

  it('extracts the id from an embed URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/abc123XYZ_9')).toBe('abc123XYZ_9');
  });

  it('returns null for a non-YouTube host', () => {
    expect(extractYoutubeVideoId('https://vimeo.com/12345')).toBeNull();
  });

  it('returns null for a YouTube URL with no video id, e.g. a channel page', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/@somechannel')).toBeNull();
  });

  it('returns null for an unparseable URL', () => {
    expect(extractYoutubeVideoId('not a url')).toBeNull();
  });
});
