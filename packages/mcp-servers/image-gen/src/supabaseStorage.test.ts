import { describe, expect, it, vi } from 'vitest';

import { storeVisualAssetInSupabase } from './supabaseStorage.js';

const config = {
  url: 'https://x.supabase.co',
  serviceRoleKey: 'service-role-key',
  bucket: 'visual-assets',
};
const request = {
  path: '2026/09/content-1/visual-1/master.png',
  base64Data: 'YmFzZTY0',
  mimeType: 'image/png',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('storeVisualAssetInSupabase', () => {
  it('uploads bytes then returns a signed URL', async () => {
    const fetchImpl = vi.fn((url: string | URL | Request) => {
      // storeVisualAssetInSupabase always calls fetchImpl with a plain string URL.
      if ((url as string).includes('/object/sign/')) {
        return Promise.resolve(
          jsonResponse({ signedURL: `/object/sign/${config.bucket}/${request.path}?token=abc` }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const outcome = await storeVisualAssetInSupabase(config, request, fetchImpl);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.result.assetPath).toBe(request.path);
    expect(outcome.result.assetUrl).toBe(
      `https://x.supabase.co/storage/v1/object/sign/visual-assets/${request.path}?token=abc`,
    );
  });

  it('never fabricates success when the upload fails', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse('forbidden', 403)));

    const outcome = await storeVisualAssetInSupabase(config, request, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.message).toContain('403');
  });

  it('returns an explicit error when the upload succeeds but signing fails', async () => {
    const fetchImpl = vi.fn((url: string | URL | Request) => {
      if ((url as string).includes('/object/sign/'))
        return Promise.resolve(jsonResponse('boom', 500));
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const outcome = await storeVisualAssetInSupabase(config, request, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error.message).toContain('Sign HTTP 500');
  });
});
