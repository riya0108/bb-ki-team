import { describe, expect, it } from 'vitest';

import { EmptyThreadError, postThread } from './threadPosting.js';
import type { PostedTweet, XApiClient } from './xApiClient.js';

function fakeApiClient(): {
  client: XApiClient;
  calls: { text: string; replyToTweetId?: string }[];
} {
  const calls: { text: string; replyToTweetId?: string }[] = [];
  let nextId = 1;
  const client: XApiClient = {
    postTweet(text, replyToTweetId) {
      calls.push(replyToTweetId === undefined ? { text } : { text, replyToTweetId });
      const posted: PostedTweet = { id: String(nextId), text };
      nextId += 1;
      return Promise.resolve(posted);
    },
    getConnectedUsername() {
      return Promise.resolve('bullorbear');
    },
  };
  return { client, calls };
}

describe('postThread', () => {
  it('posts a single tweet with no reply chain', async () => {
    const { client, calls } = fakeApiClient();
    const { posts } = await postThread(client, ['hello world']);
    expect(posts).toEqual([{ id: '1', text: 'hello world' }]);
    expect(calls).toEqual([{ text: 'hello world' }]);
  });

  it('chains each post as a reply to the previous one, in order', async () => {
    const { client, calls } = fakeApiClient();
    const { posts } = await postThread(client, ['one', 'two', 'three']);
    expect(posts.map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(calls).toEqual([
      { text: 'one' },
      { text: 'two', replyToTweetId: '1' },
      { text: 'three', replyToTweetId: '2' },
    ]);
  });

  it('throws EmptyThreadError for an empty list', async () => {
    const { client } = fakeApiClient();
    await expect(postThread(client, [])).rejects.toThrow(EmptyThreadError);
  });
});
