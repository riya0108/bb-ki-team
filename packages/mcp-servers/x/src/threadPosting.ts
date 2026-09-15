import type { PostedTweet, XApiClient } from './xApiClient.js';

export class EmptyThreadError extends Error {
  constructor() {
    super('postThread: at least one post is required');
    this.name = 'EmptyThreadError';
  }
}

export interface ThreadPostResult {
  posts: PostedTweet[];
}

// Posts one tweet, or a reply-chained thread when given more than one — each post
// after the first replies to the one before it, in order (spec 6.1's X thread mode).
export async function postThread(client: XApiClient, texts: string[]): Promise<ThreadPostResult> {
  if (texts.length === 0) throw new EmptyThreadError();

  const posts: PostedTweet[] = [];
  let replyToTweetId: string | undefined;
  for (const text of texts) {
    const posted = await client.postTweet(text, replyToTweetId);
    posts.push(posted);
    replyToTweetId = posted.id;
  }
  return { posts };
}
