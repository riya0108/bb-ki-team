import type { BufferApiClient, BufferPost } from './bufferApiClient.js';

export class BufferPostFailedError extends Error {
  constructor(post: BufferPost) {
    super(`Buffer post ${post.id} ended in status "${post.status}"`);
    this.name = 'BufferPostFailedError';
  }
}

export class BufferPostTimeoutError extends Error {
  constructor(post: BufferPost, timeoutMs: number) {
    super(`Buffer post ${post.id} did not reach "sent" within ${timeoutMs}ms (last status: "${post.status}")`);
    this.name = 'BufferPostTimeoutError';
  }
}

const TERMINAL_ERROR_STATUSES = new Set(['error', 'failed']);

export interface WaitForSentOptions {
  timeoutMs?: number;
  intervalMs?: number;
  delay?: (ms: number) => Promise<void>;
}

// createThreadPost only enqueues the send with Buffer; it has no externalLink (the
// real X post URL) until Buffer actually sends it (createPost.dueAt is our best-effort
// "now", not a completion guarantee). This is the only place that turns "we asked
// Buffer to post" into "Buffer confirms it posted" — CLAUDE.md/spec 15.4: never claim
// a post was published unless the connector confirms it.
export async function waitForSent(
  client: BufferApiClient,
  postId: string,
  options: WaitForSentOptions = {},
): Promise<BufferPost> {
  // Verified live against @bullor_bear: a post due ~60s out took several minutes end
  // to end to reach "sent" — Buffer's own send worker runs on its own cadence, not
  // proportional to how close dueAt is. 6 minutes/5s gives real headroom without
  // hammering the API.
  const timeoutMs = options.timeoutMs ?? 360_000;
  const intervalMs = options.intervalMs ?? 5_000;
  const delay = options.delay ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const deadline = Date.now() + timeoutMs;
  let post = await client.getPost(postId);
  while (post.status.toLowerCase() !== 'sent') {
    if (TERMINAL_ERROR_STATUSES.has(post.status.toLowerCase())) {
      throw new BufferPostFailedError(post);
    }
    if (Date.now() >= deadline) {
      throw new BufferPostTimeoutError(post, timeoutMs);
    }
    await delay(intervalMs);
    post = await client.getPost(postId);
  }
  return post;
}
