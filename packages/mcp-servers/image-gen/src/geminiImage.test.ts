import { describe, expect, it, vi } from 'vitest';

import { generateImageWithGemini } from './geminiImage.js';

const config = { apiKey: 'key', model: 'gemini-2.5-flash-image' };
const request = {
  prompt: 'a trader looking at a falling chart',
  aspectRatio: '4:5',
  contentId: 'content-1',
  visualId: 'visual-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('generateImageWithGemini', () => {
  it('returns the image bytes on success', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'YmFzZTY0' } }] } },
          ],
        }),
      ),
    );

    const outcome = await generateImageWithGemini(config, request, fetchImpl);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.result.base64Data).toBe('YmFzZTY0');
    expect(outcome.result.mimeType).toBe('image/png');
    expect(outcome.result.provider).toBe('gemini');
  });

  it('never fabricates success when the response has no image data', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ candidates: [{ content: { parts: [] } }] })),
    );

    const outcome = await generateImageWithGemini(config, request, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.reason).toBe('no_image_returned');
  });

  it('returns an explicit error on a non-2xx response', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse('quota exceeded', 429)));

    const outcome = await generateImageWithGemini(config, request, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.reason).toBe('non_2xx');
  });

  it('returns an explicit error on a network failure', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('ECONNRESET')));

    const outcome = await generateImageWithGemini(config, request, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.reason).toBe('network_error');
  });
});
