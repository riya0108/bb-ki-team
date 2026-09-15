import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildPostUrl } from './postUrl.js';
import { postThread } from './threadPosting.js';
import type { XApiClient } from './xApiClient.js';

export interface XMcpServerDeps {
  apiClient: XApiClient;
}

function errorPayload(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}

export function createXMcpServer(deps: XMcpServerDeps): McpServer {
  const server = new McpServer({ name: 'bb-mcp-x', version: '0.1.0' });

  server.registerTool(
    'x_whoami',
    {
      description:
        'Return the X (Twitter) username currently reachable via the configured API credentials. ' +
        'Read-only — no publishing side effects — safe to call to verify the connector is wired up correctly.',
      inputSchema: {},
    },
    async () => {
      try {
        const username = await deps.apiClient.getConnectedUsername();
        return { content: [{ type: 'text', text: JSON.stringify({ username }) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'post_tweet_thread',
    {
      description:
        'Publish tweet(s) to the connected X account. A single string in `posts` publishes one tweet; ' +
        'more than one publishes a reply-chained thread in order. This is an IRREVERSIBLE, PUBLICLY VISIBLE ' +
        'publish action — only call this from a step that runs after an approval gate has recorded an ' +
        'approved decision for this exact content version (CLAUDE.md/spec 15: never publish without approval).',
      inputSchema: { posts: z.array(z.string().min(1).max(280)).min(1) },
    },
    async ({ posts }) => {
      try {
        const { posts: published } = await postThread(deps.apiClient, posts);
        const username = await deps.apiClient.getConnectedUsername().catch(() => null);
        const first = published[0];
        if (!first) throw new Error('post_tweet_thread: no posts were published');
        const url = buildPostUrl(first.id, username);
        return { content: [{ type: 'text', text: JSON.stringify({ posts: published, url }) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }],
          isError: true,
        };
      }
    },
  );

  return server;
}
