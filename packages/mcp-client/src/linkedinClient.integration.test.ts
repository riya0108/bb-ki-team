import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createLogger } from '@bb/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FetchToolError, createLinkedinMcpClient, createYoutubeTranscriptMcpClient } from './linkedinClient.js';

// Exercises the REAL stdio-spawned MCP fetch server (not a mock), against a local
// fixture HTTP server, to prove the tool-scope boundary actually works end to end.
describe('createLinkedinMcpClient (integration, real MCP stdio server)', () => {
  let httpServer: Server;
  let baseUrl: string;

  beforeAll(async () => {
    httpServer = createServer((req, res) => {
      if (req.url === '/ok.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><head><title>Hi</title></head><body><article><p>Hello world</p></article></body></html>');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('fetches a real URL through the spawned MCP server and validates the result', async () => {
    const client = createLinkedinMcpClient(createLogger({ module: 'test' }));
    try {
      const result = await client.fetchUrl(`${baseUrl}/ok.html`);
      expect(result.title).toBe('Hi');
      expect(result.text).toContain('Hello world');
    } finally {
      await client.close();
    }
  }, 20_000);

  it('throws FetchToolError (not a fabricated result) for an inaccessible URL', async () => {
    const client = createLinkedinMcpClient(createLogger({ module: 'test' }));
    try {
      await expect(client.fetchUrl(`${baseUrl}/missing.html`)).rejects.toBeInstanceOf(FetchToolError);
    } finally {
      await client.close();
    }
  }, 20_000);
});

// Only exercises the deterministic, no-network path (an unrecognizable YouTube URL):
// the youtube-transcript package's own test suite (packages/mcp-servers/youtube-transcript)
// covers the real extraction logic against injected fetch responses. Hitting real YouTube
// from a test would be flaky and network-dependent, so this only proves the stdio
// tool-scope boundary itself works end to end.
describe('createYoutubeTranscriptMcpClient (integration, real MCP stdio server)', () => {
  it('throws FetchToolError (not a fabricated result) for a non-YouTube URL', async () => {
    const client = createYoutubeTranscriptMcpClient(createLogger({ module: 'test' }));
    try {
      await expect(client.fetchTranscript('https://example.com/not-youtube')).rejects.toBeInstanceOf(FetchToolError);
    } finally {
      await client.close();
    }
  }, 20_000);
});
