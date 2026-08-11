import { z } from 'zod';
import { ApprovalSchema, type Approval, type ApprovalDecision, type ApprovalGate } from '@ai-company/shared-types';
import { sql, toJsonValue } from './client.js';

const ApprovalRowSchema = z.object({
  id: z.string(),
  workflow_run_id: z.string(),
  gate: z.string(),
  decision: z.string(),
  selection: z.unknown().nullable(),
  feedback: z.string().nullable(),
  decided_at: z.date(),
});

function toApproval(row: unknown): Approval {
  const r = ApprovalRowSchema.parse(row);
  return ApprovalSchema.parse({
    id: r.id,
    workflowRunId: r.workflow_run_id,
    gate: r.gate,
    decision: r.decision,
    selection: r.selection,
    feedback: r.feedback,
    decidedAt: r.decided_at.toISOString(),
  });
}

export interface CreateApprovalInput {
  id: string;
  workflowRunId: string;
  gate: ApprovalGate;
  decision: ApprovalDecision;
  selection?: unknown;
  feedback?: string;
}

export async function createApproval(params: CreateApprovalInput): Promise<Approval> {
  const [row] = await sql`
    insert into approvals (id, workflow_run_id, gate, decision, selection, feedback)
    values (
      ${params.id}, ${params.workflowRunId}, ${params.gate}, ${params.decision},
      ${params.selection === undefined ? null : sql.json(toJsonValue(params.selection))},
      ${params.feedback ?? null}
    )
    returning *
  `;
  return toApproval(row);
}

export async function listApprovalsForRun(workflowRunId: string): Promise<Approval[]> {
  const rows =
    await sql`select * from approvals where workflow_run_id = ${workflowRunId} order by decided_at`;
  return rows.map(toApproval);
}

/**
 * Recent human decisions at a given gate, across all runs of the given
 * workflows — the "Do Not Recommend" learning signal (plan §45/46):
 * blog-topic-finder's candidate generation reads `feedback` from
 * `changes_requested` decisions at the 'topic' gate to avoid re-recommending
 * what the user already rejected, without needing a dedicated table. Called
 * by apps/worker before dispatching the agent, never by the agent package
 * itself — agent packages have no DB access (see CLAUDE.md's task-queue
 * boundary).
 */
export async function listRecentGateFeedback(
  params: { workflowNames: string[]; gate: ApprovalGate; decision: ApprovalDecision; limit?: number },
): Promise<Approval[]> {
  const rows = await sql`
    select a.* from approvals a
    join workflow_runs w on w.id = a.workflow_run_id
    where w.workflow_name = any(${params.workflowNames})
      and a.gate = ${params.gate}
      and a.decision = ${params.decision}
      and a.feedback is not null
    order by a.decided_at desc
    limit ${params.limit ?? 20}
  `;
  return rows.map(toApproval);
}
