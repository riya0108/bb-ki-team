import { z } from 'zod';
import { TaskSchema, type Task, type TaskAgent } from '@ai-company/shared-types';
import { sql, toJsonValue } from './client.js';

const TaskRowSchema = z.object({
  id: z.string(),
  workflow_run_id: z.string(),
  agent: z.string(),
  task_type: z.string(),
  status: z.string(),
  payload: z.unknown(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  attempts: z.number(),
  max_attempts: z.number(),
  available_at: z.date(),
  claimed_by: z.string().nullable(),
  claimed_at: z.date().nullable(),
  depends_on_task_id: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
});

function toTask(row: unknown): Task {
  const r = TaskRowSchema.parse(row);
  return TaskSchema.parse({
    id: r.id,
    workflowRunId: r.workflow_run_id,
    agent: r.agent,
    taskType: r.task_type,
    status: r.status,
    payload: r.payload,
    result: r.result,
    error: r.error,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    availableAt: r.available_at.toISOString(),
    claimedBy: r.claimed_by,
    claimedAt: r.claimed_at?.toISOString() ?? null,
    dependsOnTaskId: r.depends_on_task_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  });
}

export interface CreateTaskInput {
  id: string;
  workflowRunId: string;
  agent: TaskAgent;
  taskType: string;
  payload: unknown;
  dependsOnTaskId?: string;
}

export async function createTask(params: CreateTaskInput): Promise<Task> {
  const [row] = await sql`
    insert into tasks (id, workflow_run_id, agent, task_type, status, payload, depends_on_task_id)
    values (${params.id}, ${params.workflowRunId}, ${params.agent}, ${params.taskType}, 'pending',
      ${sql.json(toJsonValue(params.payload))}, ${params.dependsOnTaskId ?? null})
    returning *
  `;
  return toTask(row);
}

/**
 * Atomically claims the oldest available pending task via
 * SELECT ... FOR UPDATE SKIP LOCKED, so multiple apps/worker processes can
 * poll concurrently without ever double-claiming the same row.
 */
export async function claimNextTask(workerId: string): Promise<Task | undefined> {
  return sql.begin(async (tx) => {
    const [row] = await tx`
      select * from tasks
      where status = 'pending' and available_at <= now()
      order by created_at
      for update skip locked
      limit 1
    `;
    if (!row) return undefined;
    const { id } = TaskRowSchema.pick({ id: true }).parse(row);
    const [claimed] = await tx`
      update tasks set status = 'claimed', claimed_by = ${workerId}, claimed_at = now(), updated_at = now()
      where id = ${id}
      returning *
    `;
    return toTask(claimed);
  });
}

export async function markTaskRunning(id: string): Promise<void> {
  await sql`update tasks set status = 'running', updated_at = now() where id = ${id}`;
}

export async function completeTask(id: string, result: unknown): Promise<void> {
  await sql`
    update tasks set status = 'succeeded', result = ${sql.json(toJsonValue(result))}, updated_at = now()
    where id = ${id}
  `;
}

/**
 * Fails a task, retrying (back to pending after a short backoff) unless
 * it's exhausted max_attempts, in which case it's permanently failed.
 * Returns the updated row so callers can tell a retry from a permanent
 * failure (and, for the latter, fail the owning workflow run).
 */
export async function failTask(id: string, error: string): Promise<Task> {
  const [row] = await sql`
    update tasks set
      attempts = attempts + 1,
      error = ${error},
      status = case when attempts + 1 >= max_attempts then 'failed' else 'pending' end,
      available_at = case when attempts + 1 >= max_attempts then available_at else now() + interval '10 seconds' end,
      claimed_by = null,
      claimed_at = null,
      updated_at = now()
    where id = ${id}
    returning *
  `;
  return toTask(row);
}

/** Marks a task cancelled — no retry, unlike failTask; used when a run is stopped mid-flight or before its next chained task ever dispatches. */
export async function cancelTask(id: string): Promise<void> {
  await sql`update tasks set status = 'cancelled', updated_at = now() where id = ${id}`;
}

/** Cancels whichever task is still claimed/running for a run — the counterpart to forceCancelWorkflowRun, for a task whose worker died mid-flight and will never call cancelTask/completeTask/failTask itself. */
export async function cancelActiveTasksForRun(workflowRunId: string): Promise<void> {
  await sql`
    update tasks set status = 'cancelled', updated_at = now()
    where workflow_run_id = ${workflowRunId} and status in ('claimed', 'running')
  `;
}

export async function listTasksForRun(workflowRunId: string): Promise<Task[]> {
  const rows =
    await sql`select * from tasks where workflow_run_id = ${workflowRunId} order by created_at`;
  return rows.map(toTask);
}
