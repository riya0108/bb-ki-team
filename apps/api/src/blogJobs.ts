import { handleBlogChatMessage } from '@bb/agent-blog';
import type { Logger } from '@bb/core';
import type { Queryable } from '@bb/db';
import { claimNextAgentJob, completeAgentJob, failAgentJob, heartbeatAgentJob } from '@bb/db';
import type { ChatJobResult } from '@bb/shared-types';
import { ChatJobPayloadSchema } from '@bb/shared-types';

import type { BlogAgentDeps } from './blogDeps.js';

// One step of the Blog worker loop (blogWorker.ts): claim the oldest queued blog
// job, run it with the Blog agent exactly as the inline POST /blog/chat route would,
// and write the outcome back for the dashboard to pick up.

// A job whose worker stopped heart-beating for this long is treated as abandoned
// (Mac slept or the process was killed) and retried by the next claim.
export const BLOG_JOB_STALE_AFTER_MS = 10 * 60 * 1000;
export const BLOG_JOB_HEARTBEAT_MS = 60 * 1000;
export const BLOG_JOB_MAX_ATTEMPTS = 2;

export interface ProcessBlogJobDeps {
  pool: Queryable;
  logger: Logger;
  agentDeps: BlogAgentDeps;
  workerId: string;
  // Injectable for tests.
  runChat?: typeof handleBlogChatMessage;
  heartbeatMs?: number;
  // Called when a job starts; the returned function is called when it ends. The
  // Mac worker uses it to keep the machine awake only while an article is written.
  onJobStart?: () => () => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Returns true when a job was claimed (finished or failed), false when the queue
// was empty.
export async function processNextBlogJob(deps: ProcessBlogJobDeps): Promise<boolean> {
  const { pool, logger, workerId } = deps;
  const job = await claimNextAgentJob(pool, {
    platform: 'blog',
    workerId,
    staleAfterMs: BLOG_JOB_STALE_AFTER_MS,
    maxAttempts: BLOG_JOB_MAX_ATTEMPTS,
  });
  if (!job) return false;

  const log = { runId: job.runId, jobId: job.id, attempt: job.attempts };
  if (job.kind !== 'chat' || !job.sessionId) {
    await failAgentJob(pool, job.id, workerId, `Unsupported blog job kind "${job.kind}".`);
    logger.error({ ...log, kind: job.kind }, 'Blog worker: unsupported job');
    return true;
  }
  const payload = ChatJobPayloadSchema.safeParse(job.payload);
  if (!payload.success) {
    await failAgentJob(pool, job.id, workerId, 'The queued message was malformed.');
    logger.error({ ...log, err: payload.error.message }, 'Blog worker: malformed job payload');
    return true;
  }

  logger.info(log, 'Blog worker: job started');
  const jobEnded = deps.onJobStart?.();
  const heartbeat = setInterval(() => {
    heartbeatAgentJob(pool, job.id, workerId).catch((error: unknown) => {
      logger.warn({ ...log, err: describeError(error) }, 'Blog worker: heartbeat failed');
    });
  }, deps.heartbeatMs ?? BLOG_JOB_HEARTBEAT_MS);
  try {
    const runChat = deps.runChat ?? handleBlogChatMessage;
    const outcome = await runChat(
      deps.agentDeps,
      payload.data.message,
      { sessionId: job.sessionId, openContentId: payload.data.openContentId },
      job.runId,
      { userMessageRecorded: true },
    );
    const result: ChatJobResult = { reply: outcome.reply, action: outcome.action, result: outcome.result };
    const stored = await completeAgentJob(pool, job.id, workerId, result);
    if (!stored) logger.warn(log, 'Blog worker: job was reclaimed elsewhere before it finished; result discarded');
    else logger.info({ ...log, action: outcome.action }, 'Blog worker: job done');
  } catch (error) {
    const message = describeError(error);
    await failAgentJob(pool, job.id, workerId, message);
    logger.error({ ...log, err: message }, 'Blog worker: job failed');
  } finally {
    clearInterval(heartbeat);
    jobEnded?.();
  }
  return true;
}
