import { NextResponse } from 'next/server';
import { cancelWorkflowRun, getWorkflowRunStatus } from '@/lib/workflowApi';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  try {
    const status = await getWorkflowRunStatus(runId);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** Stops an in-progress run — see apps/api's handleCancel for queued/awaiting_approval-vs-running handling. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  try {
    await cancelWorkflowRun(runId);
    return NextResponse.json({ runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
