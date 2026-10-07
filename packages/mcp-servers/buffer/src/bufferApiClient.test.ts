import { describe, expect, it } from 'vitest';

import { threadMetadata } from './bufferApiClient.js';

describe('threadMetadata', () => {
  it('omits metadata for a single post', () => {
    expect(threadMetadata(['one'], 'https://example.com/a.png')).toBeUndefined();
  });

  it('attaches the image to the opening thread item only', () => {
    expect(threadMetadata(['one', 'two'], 'https://example.com/a.png')).toEqual({
      twitter: {
        thread: [
          { text: 'one', assets: [{ image: { url: 'https://example.com/a.png' } }] },
          { text: 'two', assets: [] },
        ],
      },
    });
  });

  it('sends empty assets on every item when there is no image', () => {
    expect(threadMetadata(['one', 'two'])).toEqual({
      twitter: { thread: [{ text: 'one', assets: [] }, { text: 'two', assets: [] }] },
    });
  });
});
