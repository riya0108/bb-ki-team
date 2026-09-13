import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import type { Logger } from '@bb/core';
import type { FetchResult } from '@bb/shared-types';
import { FetchResultSchema } from '@bb/shared-types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class FetchToolError extends Error {
  constructor(
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'FetchToolError';
  }
}

export interface FetchTool {
  fetchUrl(url: string): Promise<FetchResult>;
  close(): Promise<void>;
}

const require = createRequire(import.meta.url);
const FETCH_SERVER_ENTRY = fileURLToPath(new URL('../../mcp-servers/fetch/src/index.ts', import.meta.url));
const YOUTUBE_TRANSCRIPT_SERVER_ENTRY = fileURLToPath(
  new URL('../../mcp-servers/youtube-transcript/src/index.ts', import.meta.url),
);
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

// Exposes ONLY fetchUrl — this is the per-agent MCP tool-scope allowlist enforced
// by construction (CLAUDE.md: agents call tools only through MCP clients scoped
// to an explicit allowlist). There is no generic "call any tool" escape hatch.
export function createLinkedinMcpClient(_logger: Logger): FetchTool {
  const client = new Client({ name: 'bb-agent-linkedin', version: '0.1.0' });
  let connected: Promise<void> | null = null;

  function ensureConnected(): Promise<void> {
    if (!connected) {
      const transport = new StdioClientTransport({
        command: require.resolve('tsx/cli'),
        args: [FETCH_SERVER_ENTRY],
        cwd: REPO_ROOT,
      });
      connected = client.connect(transport);
    }
    return connected;
  }

  return {
    async fetchUrl(url: string): Promise<FetchResult> {
      await ensureConnected();
      const response = await client.callTool({ name: 'fetch_url', arguments: { url } });

      const content = Array.isArray(response.content) ? response.content : [];
      const textContent = content.find(isToolTextContent);
      if (!textContent) {
        throw new FetchToolError(url, 'fetch_url tool returned no text content');
      }

      const parsed: unknown = JSON.parse(textContent.text);
      if (response.isError) {
        const message = typeof (parsed as { message?: unknown }).message === 'string'
          ? (parsed as { message: string }).message
          : 'fetch_url tool reported an error';
        throw new FetchToolError(url, message);
      }

      return FetchResultSchema.parse(parsed);
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

export interface YoutubeTranscriptTool {
  fetchTranscript(url: string): Promise<FetchResult>;
  close(): Promise<void>;
}

// Exposes ONLY fetch_youtube_transcript — the same per-agent MCP tool-scope allowlist
// principle as createLinkedinMcpClient above (CLAUDE.md). A separate client/process
// from createLinkedinMcpClient's, since it talks to a different MCP server.
export function createYoutubeTranscriptMcpClient(_logger: Logger): YoutubeTranscriptTool {
  const client = new Client({ name: 'bb-agent-linkedin-youtube', version: '0.1.0' });
  let connected: Promise<void> | null = null;

  function ensureConnected(): Promise<void> {
    if (!connected) {
      const transport = new StdioClientTransport({
        command: require.resolve('tsx/cli'),
        args: [YOUTUBE_TRANSCRIPT_SERVER_ENTRY],
        cwd: REPO_ROOT,
      });
      connected = client.connect(transport);
    }
    return connected;
  }

  return {
    async fetchTranscript(url: string): Promise<FetchResult> {
      await ensureConnected();
      const response = await client.callTool({ name: 'fetch_youtube_transcript', arguments: { url } });

      const content = Array.isArray(response.content) ? response.content : [];
      const textContent = content.find(isToolTextContent);
      if (!textContent) {
        throw new FetchToolError(url, 'fetch_youtube_transcript tool returned no text content');
      }

      const parsed: unknown = JSON.parse(textContent.text);
      if (response.isError) {
        const message =
          typeof (parsed as { message?: unknown }).message === 'string'
            ? (parsed as { message: string }).message
            : 'fetch_youtube_transcript tool reported an error';
        throw new FetchToolError(url, message);
      }

      return FetchResultSchema.parse(parsed);
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}
