import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import type { Logger, XCredentials } from '@bb/core';
import type { ContentItem } from '@bb/shared-types';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class XPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XPublishError';
  }
}

const require = createRequire(import.meta.url);
const X_SERVER_ENTRY = fileURLToPath(new URL('../../mcp-servers/x/src/index.ts', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

interface ToolTextContent {
  type: 'text';
  text: string;
}

function isToolTextContent(value: unknown): value is ToolTextContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

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

// Wraps the X MCP server (packages/mcp-servers/x) the same way createLinkedinMcpClient
// wraps the fetch server — a dedicated child process per connector, spawned with ONLY
// the four X credential env vars explicitly passed through (StdioClientTransport does
// NOT inherit the parent's full env by default; CLAUDE.md: never expose API keys).
export function createXPublishConnector(
  credentials: XCredentials,
  _logger: Logger,
): PublishConnector & { close(): Promise<void> } {
  const client = new Client({ name: 'bb-connector-x', version: '0.1.0' });
  let connected: Promise<void> | null = null;

  function ensureConnected(): Promise<void> {
    if (!connected) {
      const transport = new StdioClientTransport({
        command: require.resolve('tsx/cli'),
        args: [X_SERVER_ENTRY],
        cwd: REPO_ROOT,
        env: {
          X_API_KEY: credentials.apiKey,
          X_API_SECRET: credentials.apiSecret,
          X_ACCESS_TOKEN: credentials.accessToken,
          X_ACCESS_TOKEN_SECRET: credentials.accessTokenSecret,
        },
      });
      connected = client.connect(transport);
    }
    return connected;
  }

  return {
    name: 'x-api',
    async publish(item: ContentItem): Promise<{ platformPostId: string; platformUrl: string }> {
      await ensureConnected();
      const posts = tweetsForItem(item);
      const response = await client.callTool({ name: 'post_tweet_thread', arguments: { posts } });

      const content = Array.isArray(response.content) ? response.content : [];
      const textContent = content.find(isToolTextContent);
      if (!textContent) {
        throw new XPublishError('post_tweet_thread returned no text content');
      }

      const parsed: unknown = JSON.parse(textContent.text);
      if (response.isError) {
        const message =
          typeof (parsed as { message?: unknown }).message === 'string'
            ? (parsed as { message: string }).message
            : 'post_tweet_thread reported an error';
        throw new XPublishError(message);
      }

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
