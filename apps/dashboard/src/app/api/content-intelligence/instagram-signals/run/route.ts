import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startWorkflowRun } from '@/lib/workflowApi';

export const runtime = 'nodejs';

const RunRequestSchema = z.object({
  candidateTopics: z.array(z.string().min(1)).min(1),
});

/** Search engine 3 of 4: Instagram viral signals. Runs standalone, independent of the other 3 searches. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = RunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await startWorkflowRun('instagram-viral-finder', parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
