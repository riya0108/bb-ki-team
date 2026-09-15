// x.com/i/web/status/:id resolves for any tweet regardless of handle, so it's a safe
// fallback when the connected username couldn't be read; the handle-qualified form
// is preferred when available since it's the URL X itself shows in the UI.
export function buildPostUrl(tweetId: string, username: string | null): string {
  return username
    ? `https://x.com/${username}/status/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`;
}
