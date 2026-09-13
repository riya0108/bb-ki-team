const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);

// Recognizes the handful of URL shapes YouTube actually issues: /watch?v=, youtu.be/<id>,
// /shorts/<id>, /embed/<id>. Anything else (a channel URL, a playlist, a non-YouTube host)
// returns null rather than guessing.
export function extractYoutubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) return null;

  if (parsed.hostname === 'youtu.be') {
    const id = parsed.pathname.slice(1);
    return id.length > 0 ? id : null;
  }

  if (parsed.pathname === '/watch') {
    return parsed.searchParams.get('v');
  }

  const shortsMatch = /^\/shorts\/([^/]+)/.exec(parsed.pathname);
  if (shortsMatch) return shortsMatch[1] ?? null;

  const embedMatch = /^\/embed\/([^/]+)/.exec(parsed.pathname);
  if (embedMatch) return embedMatch[1] ?? null;

  return null;
}
