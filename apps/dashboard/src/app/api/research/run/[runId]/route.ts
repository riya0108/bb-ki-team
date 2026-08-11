import { NextResponse } from 'next/server';
import { getWorkflowRunStatus } from '@/lib/workflowApi';

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
