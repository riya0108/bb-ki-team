import { z } from 'zod';
import {
  WorkflowRunSchema,
  type WorkflowRun,
  type WorkflowRunStatus,
} from '@ai-company/shared-types';
import { sql, toJsonValue } from './client.js';

const WorkflowRunRowSchema = z.object({
  id: z.string(),
  workflow_name: z.string(),
  status: z.string(),
  input: z.unknown(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  created_at: z.date(),
  updated_at: z.date(),
  started_at: z.date().nullable(),
  finished_at: z.date().nullable(),
  cancel_requested_at: z.date().nullable(),
});

function toWorkflowRun(row: unknown): WorkflowRun {
  const r = WorkflowRunRowSchema.parse(row);
  return WorkflowRunSchema.parse({
    id: r.id,
    workflowName: r.workflow_name,
    status: r.status,
    input: r.input,
    output: r.output,
    error: r.error,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    startedAt: r.started_at?.toISOString() ?? null,
    finishedAt: r.finished_at?.toISOString() ?? null,
    cancelRequestedAt: r.cancel_requested_at?.toISOString() ?? null,
  });
}

export interface CreateWorkflowRunInput {
  id: string;
  workflowName: string;
  input: unknown;
}

export async function createWorkflowRun(params: CreateWorkflowRunInput): Promise<WorkflowRun> {
  const [row] = await sql`
    insert into workflow_runs (id, workflow_name, status, input)
    values (${params.id}, ${params.workflowName}, 'queued', ${sql.json(toJsonValue(params.input))})
    returning *
  `;
  return toWorkflowRun(row);
}

export async function getWorkflowRun(id: string): Promise<WorkflowRun | undefined> {
  const [row] = await sql`select * from workflow_runs where id = ${id}`;
  return row ? toWorkflowRun(row) : undefined;
}

export async function listRecentWorkflowRuns(limit = 50): Promise<WorkflowRun[]> {
  const rows = await sql`select * from workflow_runs order by created_at desc limit ${limit}`;
  return rows.map(toWorkflowRun);
}

export interface UpdateWorkflowRunStatusInput {
  status: WorkflowRunStatus;
  output?: unknown;
  error?: string;
  markStarted?: boolean;
  markFinished?: boolean;
}

export async function updateWorkflowRunStatus(
  id: string,
  params: UpdateWorkflowRunStatusInput,
): Promise<void> {
  await sql`
    update workflow_runs set
      status = ${params.status},
      output = coalesce(${params.output === undefined ? null : sql.json(toJsonValue(params.output))}, output),
      error = coalesce(${params.error ?? null}, error),
      started_at = case when ${params.markStarted ?? false} then now() else started_at end,
      finished_at = case when ${params.markFinished ?? false} then now() else finished_at end,
      updated_at = now()
    where id = ${id}
  `;
}

/**
 * Finalizes a run that has no task actively executing right now — 'queued'
 * (nothing claimed yet) or 'awaiting_approval' (paused for a human, not
 * consuming anything). Returns the updated run, or undefined if it had
 * already reached a terminal status (nothing to cancel).
 */
export async function cancelWorkflowRunNow(id: string): Promise<WorkflowRun | undefined> {
  const [row] = await sql`
    update workflow_runs set
      status = 'cancelled',
      cancel_requested_at = coalesce(cancel_requested_at, now()),
      finished_at = now(),
      updated_at = now()
    where id = ${id} and status in ('queued', 'awaiting_approval')
    returning *
  `;
  return row ? toWorkflowRun(row) : undefined;
}

/**
 * Flags a 'running' run for cooperative cancellation — apps/worker polls
 * isWorkflowRunCancellationRequested() while a task is in flight, aborts the
 * in-flight LLM call, and stops before starting the next pipeline stage or
 * chaining to the next task.
 */
export async function requestWorkflowRunCancellation(id: string): Promise<WorkflowRun | undefined> {
  const [row] = await sql`
    update workflow_runs set cancel_requested_at = now(), updated_at = now()
    where id = ${id} and status = 'running' and cancel_requested_at is null
    returning *
  `;
  return row ? toWorkflowRun(row) : undefined;
}

export async function isWorkflowRunCancellationRequested(id: string): Promise<boolean> {
  const [row] = await sql`select cancel_requested_at from workflow_runs where id = ${id}`;
  return row?.cancel_requested_at != null;
}

/**
 * Hard-finalizes a 'running' run to 'cancelled' regardless of whether any
 * worker is still cooperatively polling for it. Only meant to be called
 * after requestWorkflowRunCancellation's flag has had a few seconds to be
 * picked up (see apps/api's handleCancel) — a live worker always reacts
 * within ~1s on its own, so still being 'running' past that grace period
 * means the worker process that claimed the task is gone (crashed/restarted)
 * and cooperative cancellation can never reach it otherwise, leaving the run
 * stuck showing "Working" forever.
 */
export async function forceCancelWorkflowRun(id: string): Promise<WorkflowRun | undefined> {
  const [row] = await sql`
    update workflow_runs set
      status = 'cancelled',
      finished_at = now(),
      updated_at = now()
    where id = ${id} and status = 'running'
    returning *
  `;
  return row ? toWorkflowRun(row) : undefined;
}
