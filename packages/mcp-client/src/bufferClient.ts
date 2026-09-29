import type { BufferCredentials, Logger } from '@bb/core';
import { getVisualAssetForVersion } from '@bb/db';
import type { Queryable } from '@bb/db';
import { createBufferApiClient, createBufferMcpServer } from '@bb/mcp-buffer';
import type { ContentItem } from '@bb/shared-types';
import type { PublishConnector } from '@bb/workflows';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { isToolTextContent, toolErrorMessage } from './mcpToolResponse.js';
import { tweetsForItem } from './xClient.js';

export class BufferPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BufferPublishError';
  }
}

const IMMEDIATE_PUBLISH_LEAD_MS = 60_000;
const X_MAX_POST_LENGTH = 280;

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
  pool: Queryable,
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
      // Fail fast with an actionable message rather than letting Buffer's own
      // schema validation reject it (which the SDK surfaces as a raw protocol-error
      // string, not a normal tool error — see mcpToolResponse.ts's toolErrorMessage).
      const tooLong = posts.find((post) => post.length > X_MAX_POST_LENGTH);
      if (tooLong) {
        throw new BufferPublishError(
          `Post exceeds X's ${X_MAX_POST_LENGTH}-character limit (${tooLong.length} characters): "${tooLong.slice(0, 60)}..."`,
        );
      }
      // Only an APPROVED visual for this exact approved content version gets attached
      // — mirrors blogGitClient.ts's own gate (a NEEDS_REVIEW image or one for a
      // since-superseded version must never ship silently; CLAUDE.md: never publish
      // without approval). Buffer fetches the URL itself rather than us uploading
      // bytes, so the signed Supabase URL (60-day expiry — supabaseStorage.ts) just
      // needs to still be live when Buffer's own send worker gets to it, which it is.
      const approvedVersion = item.approvedVersion ?? item.currentVersion;
      const visual = await getVisualAssetForVersion(pool, item.id, approvedVersion);
      const imageUrl =
        visual?.status === 'APPROVED' && visual.masterAsset.status === 'STORED'
          ? (visual.masterAsset.assetUrl ?? undefined)
          : undefined;
      // Verified live: Buffer's createPost rejects a dueAt that isn't strictly in
      // the future ("Scheduled time must be in the future"), so "now" for an
      // on-demand publish is now + a small buffer, not Date.now() itself.
      const dueAt = new Date(Date.now() + IMMEDIATE_PUBLISH_LEAD_MS).toISOString();
      // create_buffer_post blocks server-side on waitForSent (packages/mcp-servers/buffer/
      // src/postPolling.ts), which polls Buffer for up to 6 minutes before giving up. The
      // MCP SDK's own request timeout defaults to 60s, far shorter than that — left
      // unset, the client throws "Request timed out" and this gets logged as a failed
      // publish even though Buffer goes on to actually send the post (verified live:
      // the tweet went out, but the PUBLISH_EVENT ledger recorded "failed" and the
      // content item never left "scheduled", which would make the next worker tick
      // retry and create a duplicate post). Match the server's own budget plus margin.
      const CREATE_POST_TIMEOUT_MS = 400_000;
      const response = await client.callTool(
        { name: 'create_buffer_post', arguments: { posts, dueAt, imageUrl } },
        undefined,
        { timeout: CREATE_POST_TIMEOUT_MS },
      );

      const content = Array.isArray(response.content) ? response.content : [];
      const textContent = content.find(isToolTextContent);
      if (!textContent) {
        throw new BufferPublishError('create_buffer_post returned no text content');
      }

      if (response.isError) {
        throw new BufferPublishError(toolErrorMessage(textContent.text));
      }

      const parsed: unknown = JSON.parse(textContent.text);
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
