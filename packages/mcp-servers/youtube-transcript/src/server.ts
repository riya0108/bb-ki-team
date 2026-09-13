import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { fetchYoutubeTranscript } from './youtubeTranscript.js';

export function createYoutubeTranscriptMcpServer(): McpServer {
  const server = new McpServer({ name: 'bb-mcp-youtube-transcript', version: '0.1.0' });

  server.registerTool(
    'fetch_youtube_transcript',
    {
      description:
        'Fetch a YouTube video URL and return its caption track as plain text. Uses whatever ' +
        'caption track (manual or auto-generated) YouTube has published for the video — does not ' +
        'transcribe audio itself. If no caption track exists or the video is not accessible, this ' +
        'returns a structured error, never fabricated content.',
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => {
      const outcome = await fetchYoutubeTranscript(url);
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
