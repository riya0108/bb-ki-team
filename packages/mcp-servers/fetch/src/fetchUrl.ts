import type { FetchError, FetchResult } from '@bb/shared-types';
import { FetchErrorSchema, FetchResultSchema } from '@bb/shared-types';

import { extractReadableTextFromHtml, extractTextFromPdf } from './extract.js';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 50_000;

export type FetchOutcome = { ok: true; result: FetchResult } | { ok: false; error: FetchError };

function errorOutcome(sourceUrl: string, reason: FetchError['reason'], message: string): FetchOutcome {
  return { ok: false, error: FetchErrorSchema.parse({ sourceUrl, reason, message }) };
}

// Never fabricates a successful result: any network error, timeout, non-2xx
// response, unsupported content type, or oversized body returns a structured
// FetchError instead. This is what lets callers report "source not accessible"
// rather than inventing content (spec: source discovery/repurposing must never
// treat an inaccessible source as if it were fetched).
export async function fetchAndExtract(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return errorOutcome(
      url,
      isTimeout ? 'timeout' : 'network_error',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    return errorOutcome(url, 'non_2xx', `HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_BYTES) {
    return errorOutcome(url, 'too_large', `Content-Length ${contentLengthHeader} exceeds ${MAX_BYTES} bytes`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return errorOutcome(url, 'too_large', `Body of ${arrayBuffer.byteLength} bytes exceeds ${MAX_BYTES} bytes`);
  }
  const buffer = Buffer.from(arrayBuffer);

  let title: string | null = null;
  let text: string;

  if (contentType.includes('text/html')) {
    const extracted = extractReadableTextFromHtml(buffer.toString('utf8'), url);
    title = extracted.title;
    text = extracted.text;
  } else if (contentType.includes('application/pdf')) {
    text = await extractTextFromPdf(buffer);
  } else if (contentType.startsWith('text/') || /^application\/([\w.+-]+\+)?xml\b/.test(contentType)) {
    // XML (RSS/Atom feeds) is passed through raw, like plain text — the research
    // layer parses feed items itself; Readability would flatten the item structure.
    text = buffer.toString('utf8');
  } else {
    return errorOutcome(url, 'unsupported_content_type', `Unsupported content-type: ${contentType}`);
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  const finalText = truncated ? text.slice(0, MAX_TEXT_CHARS) : text;

  return {
    ok: true,
    result: FetchResultSchema.parse({
      sourceUrl: url,
      contentType,
      title,
      text: finalText,
      truncated,
      fetchedAt: new Date().toISOString(),
    }),
  };
}
