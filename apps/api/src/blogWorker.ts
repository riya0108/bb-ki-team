// The Blog worker: runs on the operator's Mac and does the Blog agent's work for
// the deployed dashboard. The deployed API (BLOG_CHAT_MODE=queue) queues each blog
// chat message in agent_jobs; this process claims them and runs them here, where
// the Claude Code CLI (the operator's own Claude plan) is installed and logged in.
// It only makes outbound connections (the database, Claude, source fetches) —
// nothing on this machine is exposed to the internet.
//
//   CLAUDE_CODE_MODEL=opus caffeinate -i npm run blog:worker
//
// While it is not running, blog messages from the dashboard simply wait in the
// queue and start as soon as it is back.
import { hostname } from 'node:os';

import { blogAgentDeps } from './blogDeps.js';
import { processNextBlogJob } from './blogJobs.js';
import { closeAppDeps, createAppDeps } from './deps.js';

const IDLE_POLL_MS = 5_000;

async function main(): Promise<void> {
  const appDeps = createAppDeps();
  const { logger } = appDeps;
  const workerId = `${hostname()}:${process.pid}`;
  if ((appDeps.env.blogClaude ?? []).length === 0) {
    logger.warn('Blog worker: no Claude backend configured (CLAUDE_CODE_MODEL or ANTHROPIC_API_KEY) — jobs will run on the free-tier chain');
  }
  logger.info({ workerId }, 'Blog worker started — waiting for blog messages from the dashboard');

  const state = { stopping: false };
  let wake: (() => void) | null = null;
  const stop = (): void => {
    if (state.stopping) return;
    state.stopping = true;
    logger.info('Blog worker stopping (a job in progress finishes first)');
    wake?.();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const agentDeps = blogAgentDeps(appDeps);
  while (!state.stopping) {
    let worked = false;
    try {
      worked = await processNextBlogJob({ pool: appDeps.pool, logger, agentDeps, workerId });
    } catch (error) {
      // Database unreachable etc.: log and keep polling rather than exiting.
      logger.error({ err: error instanceof Error ? error.message : String(error) }, 'Blog worker: polling failed');
    }
    if (!worked && !state.stopping) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, IDLE_POLL_MS);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
    }
  }
  await closeAppDeps(appDeps);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
