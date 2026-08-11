const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';

export interface StartWorkflowResult {
  runId: string;
}

/** Kicks off a workflow run via apps/api — the dashboard never calls agent packages directly (see next.config.ts). */
export async function startWorkflowRun(
  workflowName: string,
  body: unknown,
): Promise<StartWorkflowResult> {
  const response = await fetch(`${API_BASE_URL}/workflows/${workflowName}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `apps/api request failed (${String(response.status)})`;
    throw new Error(message);
  }
  return payload as StartWorkflowResult;
}

export interface WorkflowRunStatus {
  run: {
    id: string;
    status: 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed';
    output: unknown;
    error: string | null;
  };
}

export async function getWorkflowRunStatus(runId: string): Promise<WorkflowRunStatus> {
  const response = await fetch(`${API_BASE_URL}/workflows/${runId}`, { cache: 'no-store' });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `apps/api request failed (${String(response.status)})`;
    throw new Error(message);
  }
  return payload as WorkflowRunStatus;
}

export interface ApproveWorkflowRunBody {
  decision: 'approved' | 'changes_requested';
  selection?: unknown;
  feedback?: string;
}

export async function approveWorkflowRun(runId: string, body: ApproveWorkflowRunBody): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/workflows/${runId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `apps/api request failed (${String(response.status)})`;
    throw new Error(message);
  }
}
