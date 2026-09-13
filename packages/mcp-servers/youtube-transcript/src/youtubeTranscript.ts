import type { FetchResult, YoutubeTranscriptError } from '@bb/shared-types';
import { FetchResultSchema, YoutubeTranscriptErrorSchema } from '@bb/shared-types';

import { parseTimedTextXml } from './captionXml.js';
import { extractYoutubeVideoId } from './videoId.js';

const TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 50_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; BullOrBearContentTeam/0.1)';

export type TranscriptOutcome = { ok: true; result: FetchResult } | { ok: false; error: YoutubeTranscriptError };

function errorOutcome(
  videoUrl: string,
  reason: YoutubeTranscriptError['reason'],
  message: string,
): TranscriptOutcome {
  return { ok: false, error: YoutubeTranscriptErrorSchema.parse({ videoUrl, reason, message }) };
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

interface PlayerResponse {
  videoDetails?: { title?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

// Prefers a manually created English track over an auto-generated ("asr") one, since
// auto captions are noisier; falls back progressively rather than failing outright.
function selectBestTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;
  const manualEnglish = tracks.find((t) => t.languageCode.startsWith('en') && t.kind !== 'asr');
  if (manualEnglish) return manualEnglish;
  const anyEnglish = tracks.find((t) => t.languageCode.startsWith('en'));
  if (anyEnglish) return anyEnglish;
  const manual = tracks.find((t) => t.kind !== 'asr');
  return manual ?? tracks[0] ?? null;
}

// YouTube embeds the player's full data (including caption track URLs) as a JSON blob
// assigned to a global in the watch page's HTML — there is no documented public API for
// this, so this is inherently coupled to YouTube's current page structure and can break
// if they change it. That tradeoff (no API key needed, but fragile) is intentional.
function extractPlayerResponse(html: string): PlayerResponse | null {
  const match = /ytInitialPlayerResponse\s*=\s*(\{.*?\});/s.exec(html);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as PlayerResponse;
  } catch {
    return null;
  }
}

async function fetchText(
  url: string,
  fetchImpl: typeof fetch,
  headers?: Record<string, string>,
): Promise<{ ok: true; text: string } | { ok: false; status: number } | { ok: false; timedOut: true }> {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(headers ? { headers } : {}),
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, text: await response.text() };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    if (isTimeout) return { ok: false, timedOut: true };
    throw error;
  }
}

export async function fetchYoutubeTranscript(
  videoUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TranscriptOutcome> {
  const videoId = extractYoutubeVideoId(videoUrl);
  if (!videoId) {
    return errorOutcome(videoUrl, 'invalid_url', `Not a recognizable YouTube video URL: ${videoUrl}`);
  }

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let watchPage: string;
  try {
    const outcome = await fetchText(watchUrl, fetchImpl, { 'user-agent': USER_AGENT });
    if (!outcome.ok) {
      return 'timedOut' in outcome
        ? errorOutcome(videoUrl, 'timeout', 'Timed out fetching the watch page.')
        : errorOutcome(videoUrl, 'video_unavailable', `HTTP ${outcome.status} fetching the watch page.`);
    }
    watchPage = outcome.text;
  } catch (error) {
    return errorOutcome(videoUrl, 'network_error', error instanceof Error ? error.message : String(error));
  }

  const playerResponse = extractPlayerResponse(watchPage);
  if (!playerResponse) {
    return errorOutcome(videoUrl, 'parse_error', 'Could not locate player response data in the watch page.');
  }

  const title = playerResponse.videoDetails?.title ?? null;
  const tracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = selectBestTrack(tracks);
  if (!track) {
    return errorOutcome(videoUrl, 'no_captions_available', 'This video has no caption tracks available.');
  }

  let xml: string;
  try {
    const outcome = await fetchText(track.baseUrl, fetchImpl);
    if (!outcome.ok) {
      return 'timedOut' in outcome
        ? errorOutcome(videoUrl, 'timeout', 'Timed out fetching the caption track.')
        : errorOutcome(videoUrl, 'video_unavailable', `HTTP ${outcome.status} fetching the caption track.`);
    }
    xml = outcome.text;
  } catch (error) {
    return errorOutcome(videoUrl, 'network_error', error instanceof Error ? error.message : String(error));
  }

  const text = parseTimedTextXml(xml);
  if (text.length === 0) {
    return errorOutcome(videoUrl, 'no_captions_available', 'Caption track was empty after parsing.');
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  const finalText = truncated ? text.slice(0, MAX_TEXT_CHARS) : text;

  return {
    ok: true,
    result: FetchResultSchema.parse({
      sourceUrl: videoUrl,
      contentType: 'text/plain',
      title,
      text: finalText,
      truncated,
      fetchedAt: new Date().toISOString(),
    }),
  };
}
