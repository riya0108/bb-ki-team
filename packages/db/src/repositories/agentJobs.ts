import type { AgentJob } from '@bb/shared-types';
import { AgentJobSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

// The task queue between the deployed API and an out-of-process worker
// (migration 0021_agent_jobs.sql).

interface AgentJobRow {
  id: string;
  platform: string;
  kind: string;
  session_id: string | null;
  run_id: string;
  payload: unknown;
  status: string;
  result: unknown;
  error: string | null;
  attempts: number;
  worker_id: string | null;
  created_at: Date;
  started_at: Date | null;
  heartbeat_at: Date | null;
  finished_at: Date | null;
}

function mapRow(row: AgentJobRow): AgentJob {
  return AgentJobSchema.parse({
    id: row.id,
    platform: row.platform,
    kind: row.kind,
    sessionId: row.session_id,
    runId: row.run_id,
    payload: row.payload,
    status: row.status,
    result: row.result ?? null,
    error: row.error,
    attempts: row.attempts,
    workerId: row.worker_id,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    heartbeatAt: row.heartbeat_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  });
}

function only(rows: AgentJobRow[], what: string): AgentJob {
  const row = rows[0];
  if (!row) throw new Error(`${what}: no row returned`);
  return mapRow(row);
}

export interface EnqueueAgentJobInput {
  platform: string;
  kind: string;
  sessionId: string | null;
  runId: string;
  payload: unknown;
}

export async function enqueueAgentJob(db: Queryable, input: EnqueueAgentJobInput): Promise<AgentJob> {
  const result = await db.query<AgentJobRow>(
    `INSERT INTO agent_jobs (platform, kind, session_id, run_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [input.platform, input.kind, input.sessionId, input.runId, JSON.stringify(input.payload)],
  );
  return only(result.rows, 'enqueueAgentJob');
}

export async function getAgentJob(db: Queryable, id: string): Promise<AgentJob | null> {
  const result = await db.query<AgentJobRow>('SELECT * FROM agent_jobs WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

// The newest unfinished job in a chat session, so a reopened dashboard can resume
// waiting for it.
export async function getPendingAgentJobForSession(db: Queryable, sessionId: string): Promise<AgentJob | null> {
  const result = await db.query<AgentJobRow>(
    `SELECT * FROM agent_jobs
     WHERE session_id = $1 AND status IN ('queued', 'running')
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export interface ClaimAgentJobOptions {
  platform: string;
  workerId: string;
  // A running job whose heartbeat is older than this is treated as abandoned.
  staleAfterMs: number;
  maxAttempts: number;
}

// Fails abandoned jobs that already used every attempt, then atomically claims the
// oldest queued (or abandoned, retryable) job. SKIP LOCKED lets several workers
// poll safely without ever claiming the same job twice.
export async function claimNextAgentJob(db: Queryable, options: ClaimAgentJobOptions): Promise<AgentJob | null> {
  await db.query(
    `UPDATE agent_jobs
     SET status = 'failed', finished_at = now(),
         error = 'The worker stopped responding while running this job (Mac asleep or closed?) and it ran out of retries.'
     WHERE platform = $1 AND status = 'running'
       AND heartbeat_at < now() - ($2::int * interval '1 millisecond')
       AND attempts >= $3`,
    [options.platform, options.staleAfterMs, options.maxAttempts],
  );
  const result = await db.query<AgentJobRow>(
    `UPDATE agent_jobs
     SET status = 'running', attempts = attempts + 1, worker_id = $2,
         started_at = now(), heartbeat_at = now(), error = NULL
     WHERE id = (
       SELECT id FROM agent_jobs
       WHERE platform = $1
         AND (status = 'queued'
              OR (status = 'running' AND heartbeat_at < now() - ($3::int * interval '1 millisecond') AND attempts < $4))
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [options.platform, options.workerId, options.staleAfterMs, options.maxAttempts],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function heartbeatAgentJob(db: Queryable, id: string, workerId: string): Promise<void> {
  await db.query(`UPDATE agent_jobs SET heartbeat_at = now() WHERE id = $1 AND worker_id = $2 AND status = 'running'`, [id, workerId]);
}

// Both finishers only apply while this worker still owns the running job, so a job
// that was reclaimed after a stall is never overwritten by the stalled worker.
export async function completeAgentJob(db: Queryable, id: string, workerId: string, result: unknown): Promise<boolean> {
  const updated = await db.query(
    `UPDATE agent_jobs SET status = 'done', result = $3::jsonb, finished_at = now()
     WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
    [id, workerId, JSON.stringify(result)],
  );
  return (updated.rowCount ?? 0) > 0;
}

export async function failAgentJob(db: Queryable, id: string, workerId: string, error: string): Promise<boolean> {
  const updated = await db.query(
    `UPDATE agent_jobs SET status = 'failed', error = $3, finished_at = now()
     WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
    [id, workerId, error],
  );
  return (updated.rowCount ?? 0) > 0;
}
