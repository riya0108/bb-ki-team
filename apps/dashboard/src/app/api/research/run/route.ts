import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startWorkflowRun } from '@/lib/workflowApi';

export const runtime = 'nodejs';

const RunRequestSchema = z.object({
  query: z.string().min(1).max(300),
});

export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = RunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await startWorkflowRun('research-with-trends', parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
