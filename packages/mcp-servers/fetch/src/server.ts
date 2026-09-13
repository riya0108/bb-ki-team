import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { fetchAndExtract } from './fetchUrl.js';

export function createFetchMcpServer(): McpServer {
  const server = new McpServer({ name: 'bb-mcp-fetch', version: '0.1.0' });

  server.registerTool(
    'fetch_url',
    {
      description:
        'Fetch a URL (article, public page, or PDF) and return its readable text content. ' +
        'Does not authenticate and does not bypass paywalls, logins, or anti-bot controls — ' +
        'if the URL is not accessible this returns an error, never fabricated content.',
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => {
      const outcome = await fetchAndExtract(url);
      if (!outcome.ok) {
        return {
          content: [{ type: 'text', text: JSON.stringify(outcome.error) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(outcome.result) }],
      };
    },
  );

  return server;
}
