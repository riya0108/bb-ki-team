import { describe, expect, it } from 'vitest';

import { fetchYoutubeTranscript } from './youtubeTranscript.js';

const WATCH_URL = 'https://www.youtube.com/watch?v=abc123';
const CAPTION_URL = 'https://www.youtube.com/api/timedtext?v=abc123&lang=en';

function watchPageHtml(captionTracks: unknown[], title = 'A Test Video'): string {
  const playerResponse = {
    videoDetails: { title },
    captions: { playerCaptionsTracklistRenderer: { captionTracks } },
  };
  return `<html><body><script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script></body></html>`;
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const handler = routes[url];
    if (!handler) throw new Error(`fakeFetch: no route configured for ${url}`);
    return Promise.resolve(handler());
  };
}

describe('fetchYoutubeTranscript', () => {
  it('extracts the transcript from the best available caption track', async () => {
    const html = watchPageHtml([
      { baseUrl: CAPTION_URL, languageCode: 'en', kind: 'asr' },
      { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc123&lang=hi', languageCode: 'hi' },
    ]);
    const xml = '<transcript><text start="0" dur="1">Hello world</text></transcript>';

    const fetchImpl = fakeFetch({
      [WATCH_URL]: () => new Response(html, { status: 200 }),
      [CAPTION_URL]: () => new Response(xml, { status: 200 }),
    });

    const outcome = await fetchYoutubeTranscript(WATCH_URL, fetchImpl);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toBe('Hello world');
    expect(outcome.result.title).toBe('A Test Video');
    expect(outcome.result.truncated).toBe(false);
  });

  it('prefers a manually created English track over an auto-generated one', async () => {
    const manualUrl = 'https://www.youtube.com/api/timedtext?v=abc123&lang=en&manual=1';
    const html = watchPageHtml([
      { baseUrl: CAPTION_URL, languageCode: 'en', kind: 'asr' },
      { baseUrl: manualUrl, languageCode: 'en' },
    ]);

    const fetchImpl = fakeFetch({
      [WATCH_URL]: () => new Response(html, { status: 200 }),
      [manualUrl]: () => new Response('<transcript><text start="0" dur="1">Manual track</text></transcript>', { status: 200 }),
    });

    const outcome = await fetchYoutubeTranscript(WATCH_URL, fetchImpl);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.text).toBe('Manual track');
  });

  it('returns invalid_url for a non-YouTube URL without making any request', async () => {
    const fetchImpl = fakeFetch({});
    const outcome = await fetchYoutubeTranscript('https://vimeo.com/12345', fetchImpl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('invalid_url');
  });

  it('returns no_captions_available when the video has no caption tracks', async () => {
    const fetchImpl = fakeFetch({
      [WATCH_URL]: () => new Response(watchPageHtml([]), { status: 200 }),
    });

    const outcome = await fetchYoutubeTranscript(WATCH_URL, fetchImpl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('no_captions_available');
  });

  it('returns video_unavailable for a non-2xx watch page response', async () => {
    const fetchImpl = fakeFetch({
      [WATCH_URL]: () => new Response('not found', { status: 404 }),
    });

    const outcome = await fetchYoutubeTranscript(WATCH_URL, fetchImpl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('video_unavailable');
  });

  it('returns parse_error when the watch page has no player response data', async () => {
    const fetchImpl = fakeFetch({
      [WATCH_URL]: () => new Response('<html><body>nothing here</body></html>', { status: 200 }),
    });

    const outcome = await fetchYoutubeTranscript(WATCH_URL, fetchImpl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('parse_error');
  });

  it('returns network_error when the underlying fetch throws', async () => {
    const fetchImpl = (() => {
      throw new Error('DNS lookup failed');
    }) as typeof fetch;

    const outcome = await fetchYoutubeTranscript(WATCH_URL, fetchImpl);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.reason).toBe('network_error');
  });
});
