import type { Logger, XCredentials } from '@bb/core';
import { createXApiClient, createXMcpServer } from '@bb/mcp-x';
import type { ContentItem } from '@bb/shared-types';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { isToolTextContent, toolErrorMessage } from './mcpToolResponse.js';

export class XPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XPublishError';
  }
}

const X_MAX_POST_LENGTH = 280;

// A thread (spec 6.1) is posted as its threadPosts array, in order; every other X
// mode (single/quote) is one post carrying item.currentText (packaging.ts: finalCopy
// always mirrors currentText, threadPosts is null outside thread mode).
export function tweetsForItem(item: ContentItem): string[] {
  const threadPosts = (item.package as { threadPosts?: unknown } | null)?.threadPosts;
  if (Array.isArray(threadPosts) && threadPosts.length > 0) {
    return threadPosts.filter((post): post is string => typeof post === 'string');
  }
  return [item.currentText];
}

interface PostTweetThreadResult {
  posts: { id: string; text: string }[];
  url: string;
}

// Wraps the X MCP server (packages/mcp-servers/x) via an in-process InMemoryTransport
// pair — see blogGitClient.ts's equivalent comment for the full reasoning (cuts
// memory overhead, keeps the MCP tool-boundary, drops the OS-process isolation a
// spawned subprocess added on top). `credentials` is passed directly rather than
// via subprocess env vars, achieving the same scoping (CLAUDE.md: never expose API
// keys) without a child process.
export function createXPublishConnector(
  credentials: XCredentials,
  _logger: Logger,
): PublishConnector & { close(): Promise<void> } {
  const client = new Client({ name: 'bb-connector-x', version: '0.1.0' });
  let connected: Promise<void> | null = null;

  function ensureConnected(): Promise<void> {
    if (!connected) {
      const apiClient = createXApiClient({
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        accessToken: credentials.accessToken,
        accessTokenSecret: credentials.accessTokenSecret,
      });
      const server = createXMcpServer({ apiClient });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      connected = Promise.all([client.connect(clientTransport), server.connect(serverTransport)]).then(
        () => undefined,
      );
    }
    return connected;
  }

  return {
    name: 'x-api',
    async publish(item: ContentItem): Promise<{ platformPostId: string; platformUrl: string }> {
      await ensureConnected();
      const posts = tweetsForItem(item);
      const tooLong = posts.find((post) => post.length > X_MAX_POST_LENGTH);
      if (tooLong) {
        throw new XPublishError(
          `Post exceeds X's ${X_MAX_POST_LENGTH}-character limit (${tooLong.length} characters): "${tooLong.slice(0, 60)}..."`,
        );
      }
      const response = await client.callTool({ name: 'post_tweet_thread', arguments: { posts } });

      const content = Array.isArray(response.content) ? response.content : [];
      const textContent = content.find(isToolTextContent);
      if (!textContent) {
        throw new XPublishError('post_tweet_thread returned no text content');
      }

      if (response.isError) {
        throw new XPublishError(toolErrorMessage(textContent.text));
      }

      const parsed: unknown = JSON.parse(textContent.text);
      const result = parsed as PostTweetThreadResult;
      const first = result.posts[0];
      if (!first) {
        throw new XPublishError('post_tweet_thread returned no posts');
      }
      return { platformPostId: first.id, platformUrl: result.url };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

// X's API has no native "schedule this post for later" endpoint on this account's
// tier — that's an X web/app-only feature, not part of the public API. So "scheduling"
// on this platform is entirely our own doing: requestSchedule (packages/workflows)
// already records the target time in the PUBLISH_EVENT ledger before this connector
// is ever called, so there's nothing left to do here except let that succeed.
// apps/worker polls for due schedules and fires the real (free) publish call itself.
export function createXScheduleConnector(): ScheduleConnector {
  return {
    name: 'x-worker-scheduled',
    schedule(): Promise<void> {
      return Promise.resolve();
    },
  };
}
