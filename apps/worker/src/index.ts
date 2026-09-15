import { closeWorkerDeps, createWorkerDeps } from './deps.js';
import { runSchedulerTick } from './poll.js';

const DEFAULT_POLL_INTERVAL_MS = 60_000;

function pollIntervalMs(env: NodeJS.ProcessEnv): number {
  const raw = env.WORKER_POLL_INTERVAL_MS;
  if (!raw) return DEFAULT_POLL_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_INTERVAL_MS;
}

function main(): void {
  const deps = createWorkerDeps();
  const intervalMs = pollIntervalMs(process.env);

  deps.logger.info({ intervalMs }, 'apps/worker starting — polling for due scheduled content');

  const tick = (): void => {
    runSchedulerTick(deps).catch((error: unknown) => {
      deps.logger.error({ err: error }, 'Scheduler tick failed');
    });
  };
  tick();
  const interval = setInterval(tick, intervalMs);

  const shutdown = (): void => {
    clearInterval(interval);
    closeWorkerDeps(deps).catch((error: unknown) => {
      deps.logger.error({ err: error }, 'Error while closing worker dependencies during shutdown');
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
