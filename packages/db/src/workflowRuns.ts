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
