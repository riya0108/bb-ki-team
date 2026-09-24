export interface GenerateImageRequest {
  prompt: string;
  negativePrompt?: string | undefined;
  aspectRatio: string;
  contentId: string;
  visualId: string;
}

export interface GeneratedImage {
  provider: 'gemini';
  model: string;
  generationId: string;
  base64Data: string;
  mimeType: string;
}

export interface GenerateImageError {
  reason: 'network_error' | 'timeout' | 'no_provider' | 'no_image_returned' | 'non_2xx';
  message: string;
}

export type GenerateImageOutcome =
  { ok: true; result: GeneratedImage } | { ok: false; error: GenerateImageError };

export interface GeminiImageConfig {
  apiKey: string;
  model: string;
}

const TIMEOUT_MS = 60_000;

function buildPrompt(request: GenerateImageRequest): string {
  const parts = [request.prompt, `Aspect ratio: ${request.aspectRatio}.`];
  if (request.negativePrompt) parts.push(`Avoid: ${request.negativePrompt}.`);
  return parts.join('\n');
}

interface GeminiInlineDataPart {
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiGenerateContentResponse {
  candidates?: { content?: { parts?: GeminiInlineDataPart[] } }[];
}

// Never fabricates a successful result: any network error, timeout, non-2xx
// response, or a response with no inline image data returns a structured error
// instead (mirrors packages/mcp-servers/fetch/src/fetchUrl.ts's outcome pattern).
// CLAUDE.md/the visual agent skill: never claim an image was generated without a
// returned asset.
export async function generateImageWithGemini(
  config: GeminiImageConfig,
  request: GenerateImageRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<GenerateImageOutcome> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(request) }] }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
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

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable body>');
    return {
      ok: false,
      error: { reason: 'non_2xx', message: `HTTP ${response.status}: ${body.slice(0, 500)}` },
    };
  }

  const json = (await response.json()) as GeminiGenerateContentResponse;
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const inlineData = part?.inlineData;
  if (!inlineData?.data) {
    return {
      ok: false,
      error: { reason: 'no_image_returned', message: 'Gemini response contained no image data' },
    };
  }

  return {
    ok: true,
    result: {
      provider: 'gemini',
      model: config.model,
      generationId: `${request.contentId}:${request.visualId}:${Date.now()}`,
      base64Data: inlineData.data,
      mimeType: inlineData.mimeType ?? 'image/png',
    },
  };
}
