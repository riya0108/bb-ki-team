export interface SupabaseStorageConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

export interface StoreVisualAssetRequest {
  path: string;
  base64Data: string;
  mimeType: string;
  // Signed URLs expire; drafts under review may sit unapproved for a while, and the
  // dashboard is a single-operator tool with no other viewer, so a long expiry is
  // preferred over making the bucket public (CLAUDE.md: never publish without
  // approval — an unapproved asset shouldn't get a permanent public URL by accident).
  signedUrlExpirySeconds?: number;
}

export interface StoredVisualAsset {
  assetPath: string;
  assetUrl: string;
}

export interface StoreVisualAssetError {
  reason: 'network_error' | 'timeout' | 'non_2xx';
  message: string;
}

export type StoreVisualAssetOutcome =
  { ok: true; result: StoredVisualAsset } | { ok: false; error: StoreVisualAssetError };

const TIMEOUT_MS = 30_000;
const DEFAULT_SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 60; // 60 days

export interface SignAssetError {
  reason: 'network_error' | 'timeout' | 'non_2xx';
  message: string;
}

export type SignAssetOutcome = { ok: true; assetUrl: string } | { ok: false; error: SignAssetError };

// Signs an already-uploaded object path — no re-upload. Used both by the upload
// path below and standalone by anything that reads back a path stored earlier
// (e.g. the reference-asset library, whose rows are meant to be read long after
// their signed URL from upload time has expired).
export async function signAssetInSupabase(
  config: SupabaseStorageConfig,
  path: string,
  expirySeconds: number = DEFAULT_SIGNED_URL_EXPIRY_SECONDS,
  fetchImpl: typeof fetch = fetch,
): Promise<SignAssetOutcome> {
  const signUrl = `${config.url}/storage/v1/object/sign/${config.bucket}/${path}`;
  try {
    const signResponse = await fetchImpl(signUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: expirySeconds }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!signResponse.ok) {
      const body = await signResponse.text().catch(() => '<unreadable body>');
      return {
        ok: false,
        error: { reason: 'non_2xx', message: `Sign HTTP ${signResponse.status}: ${body.slice(0, 500)}` },
      };
    }

    const signed = (await signResponse.json()) as { signedURL?: string };
    if (!signed.signedURL) {
      return { ok: false, error: { reason: 'non_2xx', message: 'Supabase Storage returned no signedURL' } };
    }

    return { ok: true, assetUrl: `${config.url}/storage/v1${signed.signedURL}` };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      error: {
        reason: isTimeout ? 'timeout' : 'network_error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function storeVisualAssetInSupabase(
  config: SupabaseStorageConfig,
  request: StoreVisualAssetRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<StoreVisualAssetOutcome> {
  const uploadUrl = `${config.url}/storage/v1/object/${config.bucket}/${request.path}`;
  const bytes = Buffer.from(request.base64Data, 'base64');

  try {
    const uploadResponse = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
        'content-type': request.mimeType,
        'x-upsert': 'true',
      },
      body: bytes,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!uploadResponse.ok) {
      const body = await uploadResponse.text().catch(() => '<unreadable body>');
      return {
        ok: false,
        error: {
          reason: 'non_2xx',
          message: `Upload HTTP ${uploadResponse.status}: ${body.slice(0, 500)}`,
        },
      };
    }

    const signed = await signAssetInSupabase(
      config,
      request.path,
      request.signedUrlExpirySeconds ?? DEFAULT_SIGNED_URL_EXPIRY_SECONDS,
      fetchImpl,
    );
    if (!signed.ok) return signed;

    return { ok: true, result: { assetPath: request.path, assetUrl: signed.assetUrl } };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      error: {
        reason: isTimeout ? 'timeout' : 'network_error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
