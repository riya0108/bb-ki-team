import { NextResponse } from 'next/server';
import { GenerateBlogCandidatesTaskPayloadSchema } from '@ai-company/shared-types';
import { startWorkflowRun } from '@/lib/workflowApi';

export const runtime = 'nodejs';

/** Search engine 1 of 4: blog topic candidates. Runs standalone, independent of the other 3 searches. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = GenerateBlogCandidatesTaskPayloadSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await startWorkflowRun('blog-topic-finder', parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
