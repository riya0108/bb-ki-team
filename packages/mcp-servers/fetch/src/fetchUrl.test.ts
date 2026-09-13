import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fetchAndExtract } from './fetchUrl.js';

const FIXTURE_HTML = `<!doctype html>
<html>
  <head><title>Test Article</title></head>
  <body>
    <nav>Nav junk that Readability should strip</nav>
    <article>
      <h1>Test Article</h1>
      <p>This is the first paragraph of the real content.</p>
      <p>This is the second paragraph, which should also survive extraction.</p>
    </article>
    <footer>Footer junk</footer>
  </body>
</html>`;

describe('fetchAndExtract (against a local fixture HTTP server)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/article.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(FIXTURE_HTML);
      } else if (req.url === '/plain.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('just plain text');
      } else if (req.url === '/unsupported.bin') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end('binary junk');
      } else if (req.url === '/server-error') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
      } else if (req.url === '/too-large') {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '999999999' });
        res.end('short body, but the header lies');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('extracts clean readable text from an HTML article, stripping nav/footer', async () => {
    const outcome = await fetchAndExtract(`${baseUrl}/article.html`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.title).toBe('Test Article');
    expect(outcome.result.text).toContain('first paragraph');
    expect(outcome.result.text).toContain('second paragraph');
    expect(outcome.result.text).not.toContain('Nav junk');
    expect(outcome.result.text).not.toContain('Footer junk');
    expect(outcome.result.truncated).toBe(false);
  });

  it('passes plain text through unchanged', async () => {
    const outcome = await fetchAndExtract(`${baseUrl}/plain.txt`);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toBe('just plain text');
  });

  it('returns a structured error for an unsupported content type, never fabricating content', async () => {
    const outcome = await fetchAndExtract(`${baseUrl}/unsupported.bin`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('unsupported_content_type');
  });

  it('returns a structured error for a non-2xx response', async () => {
    const outcome = await fetchAndExtract(`${baseUrl}/server-error`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('non_2xx');
  });

  it('returns a structured error when Content-Length exceeds the cap', async () => {
    const outcome = await fetchAndExtract(`${baseUrl}/too-large`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('too_large');
  });

  it('returns a structured error for a dead host, never throwing', async () => {
    const outcome = await fetchAndExtract('http://127.0.0.1:1/nope');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('network_error');
  });
});
