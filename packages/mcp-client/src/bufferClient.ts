import type { BufferCredentials, Logger } from '@bb/core';
import { createBufferApiClient, createBufferMcpServer } from '@bb/mcp-buffer';
import type { ContentItem } from '@bb/shared-types';
import type { PublishConnector } from '@bb/workflows';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { tweetsForItem } from './xClient.js';

export class BufferPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BufferPublishError';
  }
}

const IMMEDIATE_PUBLISH_LEAD_MS = 60_000;

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

interface CreateBufferPostResult {
  id: string;
  status: string;
  externalLink: string | null;
}

// x.com/i/web/status/:id resolves for any tweet regardless of handle — Buffer's
// externalLink is already a full x.com URL, so the numeric id is just its last path
// segment (mirrors packages/mcp-servers/x's buildPostUrl, in reverse).
export function tweetIdFromUrl(url: string): string {
  const segments = url.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) throw new BufferPublishError(`Could not extract a tweet id from Buffer externalLink "${url}"`);
  return last;
}

// Wraps the Buffer MCP server (packages/mcp-servers/buffer) via an in-process
// InMemoryTransport pair — see blogGitClient.ts's equivalent comment for why (cuts
// memory overhead, keeps the MCP tool-boundary but drops the OS-process isolation
// a spawned subprocess added on top). `credentials` is passed directly rather than
// via subprocess env vars, achieving the same "only pass what's needed" scoping
// (CLAUDE.md: never expose API keys) without needing a child process. This is
// platform "x"'s real publish connector: X's own direct API (xClient.ts) demands
// paid credits per post on this account, so Buffer — which schedules/publishes to
// X on this account's behalf for free — is what apps/api and apps/worker actually
// register (see apps/api/src/deps.ts).
export function createBufferPublishConnector(
  credentials: BufferCredentials,
  _logger: Logger,
): PublishConnector & { close(): Promise<void> } {
  const client = new Client({ name: 'bb-connector-buffer', version: '0.1.0' });
  let connected: Promise<void> | null = null;

  function ensureConnected(): Promise<void> {
    if (!connected) {
      const apiClient = createBufferApiClient(credentials);
      const server = createBufferMcpServer({ apiClient });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      connected = Promise.all([client.connect(clientTransport), server.connect(serverTransport)]).then(
        () => undefined,
      );
    }
    return connected;
  }

  return {
    name: 'buffer-api',
    async publish(item: ContentItem): Promise<{ platformPostId: string; platformUrl: string }> {
      await ensureConnected();
      const posts = tweetsForItem(item);
      // Verified live: Buffer's createPost rejects a dueAt that isn't strictly in
      // the future ("Scheduled time must be in the future"), so "now" for an
      // on-demand publish is now + a small buffer, not Date.now() itself.
      const dueAt = new Date(Date.now() + IMMEDIATE_PUBLISH_LEAD_MS).toISOString();
      const response = await client.callTool({
        name: 'create_buffer_post',
        arguments: { posts, dueAt },
      });

      const content = Array.isArray(response.content) ? response.content : [];
      const textContent = content.find(isToolTextContent);
      if (!textContent) {
        throw new BufferPublishError('create_buffer_post returned no text content');
      }

      const parsed: unknown = JSON.parse(textContent.text);
      if (response.isError) {
        const message =
          typeof (parsed as { message?: unknown }).message === 'string'
            ? (parsed as { message: string }).message
            : 'create_buffer_post reported an error';
        throw new BufferPublishError(message);
      }

      const result = parsed as CreateBufferPostResult;
      if (!result.externalLink) {
        throw new BufferPublishError(`Buffer post ${result.id} has no externalLink after sending`);
      }
      return { platformPostId: tweetIdFromUrl(result.externalLink), platformUrl: result.externalLink };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}
