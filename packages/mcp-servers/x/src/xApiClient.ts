import { TwitterApi } from 'twitter-api-v2';

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface PostedTweet {
  id: string;
  text: string;
}

// The real-network boundary — everything above this (server.ts, threadPosting.ts)
// depends only on this interface, so thread-chaining and tool-routing logic stay
// unit-testable against a fake without a live X account (CLAUDE.md: every module
// that touches external state must be testable in isolation).
export interface XApiClient {
  postTweet(text: string, replyToTweetId?: string): Promise<PostedTweet>;
  getConnectedUsername(): Promise<string>;
}

export function createXApiClient(credentials: XCredentials): XApiClient {
  const client = new TwitterApi({
    appKey: credentials.apiKey,
    appSecret: credentials.apiSecret,
    accessToken: credentials.accessToken,
    accessSecret: credentials.accessTokenSecret,
  }).v2;

  return {
    async postTweet(text, replyToTweetId) {
      const result = replyToTweetId
        ? await client.tweet(text, { reply: { in_reply_to_tweet_id: replyToTweetId } })
        : await client.tweet(text);
      return { id: result.data.id, text: result.data.text };
    },
    async getConnectedUsername() {
      const me = await client.me();
      return me.data.username;
    },
  };
}
