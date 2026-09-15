import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { BufferApiClient } from './bufferApiClient.js';
import { waitForSent } from './postPolling.js';

export interface BufferMcpServerDeps {
  apiClient: BufferApiClient;
}

function errorPayload(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}

export function createBufferMcpServer(deps: BufferMcpServerDeps): McpServer {
  const server = new McpServer({ name: 'bb-mcp-buffer', version: '0.1.0' });

  server.registerTool(
    'list_buffer_channels',
    {
      description:
        'List every channel connected to this Buffer account (id, display name, service). ' +
        'Read-only — no publishing side effects — use this to find the channel id for the ' +
        'X/Twitter account being automated.',
      inputSchema: {},
    },
    async () => {
      try {
        const channels = await deps.apiClient.listChannels();
        return { content: [{ type: 'text', text: JSON.stringify({ channels }) }] };
      } catch (error) {
        return {
          content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'create_buffer_post',
    {
      description:
        'Publish tweet(s) to the connected X account via Buffer. A single string in `posts` ' +
        'publishes one tweet; more than one publishes a reply-chained thread in order. `dueAt` ' +
        'is an ISO 8601 datetime and MUST be strictly in the future (Buffer rejects "now") — ' +
        'pass a minute or more out for an effectively-immediate publish, or a later time to ' +
        'have Buffer send it then; either way this call blocks until Buffer actually confirms ' +
        'the send (can take several minutes past dueAt). This is an IRREVERSIBLE, PUBLICLY VISIBLE publish ' +
        'action — only call this from a step that runs after an approval gate has recorded an ' +
        'approved decision for this exact content version (CLAUDE.md/spec 15: never publish ' +
        'without approval).',
      inputSchema: {
        posts: z.array(z.string().min(1).max(280)).min(1),
        dueAt: z.string().datetime(),
      },
    },
    async ({ posts, dueAt }) => {
      try {
        const created = await deps.apiClient.createThreadPost(posts, new Date(dueAt));
        const sent = await waitForSent(deps.apiClient, created.id);
        return { content: [{ type: 'text', text: JSON.stringify(sent) }] };
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
