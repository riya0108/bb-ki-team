import type { EmailConfig, Env, Logger } from '@bb/core';
import { createLogger, loadEnv } from '@bb/core';
import type { Pool } from '@bb/db';
import { createPool } from '@bb/db';
import { createBufferPublishConnector } from '@bb/mcp-client';
import type { PublishConnector } from '@bb/workflows';

// Composition root for the index.ts setInterval loop below. That loop
// (runSchedulerTick -> publishDueSchedules) finds every content item whose
// scheduledFor time (recorded by requestSchedule, see @bb/workflows) has arrived and
// actually publishes it through whatever connector is registered here — Buffer for
// platform "x", since X's own direct API demands paid credits per post on this
// account (see apps/api/src/deps.ts). Buffer does its own internal scheduling too,
// but our own DB stays the timing authority: each connector is only called the
// moment apps/worker decides a schedule is due.
//
// Platform "blog" is deliberately NOT registered here anymore: firing due blog
// schedules moved to a Supabase pg_cron job calling the fire-due-schedules Edge
// Function (supabase/functions/fire-due-schedules), so a scheduled blog post still
// publishes even with this process (and the laptop it runs on) offline. Registering
// the old blog-git connector here too would let both fire the same due item in the
// same ~1-minute window — each side individually guards against a genuine double
// PUBLISH, but it'd still race to be first and waste a GitHub API/commit attempt.
export interface WorkerDeps {
  env: Env;
  pool: Pool;
  logger: Logger;
  publishConnectors: Record<string, PublishConnector>;
  email?: EmailConfig | undefined;
}

export function createWorkerDeps(): WorkerDeps {
  const env = loadEnv();
  const logger = createLogger({ module: 'worker' });
  const pool = createPool(env.databaseUrl);

  const publishConnectors: Record<string, PublishConnector> = {};
  if (env.buffer) {
    publishConnectors.x = createBufferPublishConnector(env.buffer, logger, pool);
  }

  return { env, pool, logger, publishConnectors, email: env.email };
}

function closeable(
  connector: PublishConnector,
): connector is PublishConnector & { close: () => Promise<void> } {
  return typeof (connector as { close?: unknown }).close === 'function';
}

export async function closeWorkerDeps(deps: WorkerDeps): Promise<void> {
  const connectorCloses = Object.values(deps.publishConnectors)
    .filter(closeable)
    .map((connector) => connector.close());
  await Promise.all([deps.pool.end(), ...connectorCloses]);
}
