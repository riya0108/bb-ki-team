import { NextResponse } from 'next/server';
import { z } from 'zod';
import { approveWorkflowRun } from '@/lib/workflowApi';

export const runtime = 'nodejs';

const ApproveRequestSchema = z.object({
  decision: z.enum(['approved', 'changes_requested']),
  selection: z.unknown().optional(),
  feedback: z.string().min(1).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  const parsed = ApproveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await approveWorkflowRun(runId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
