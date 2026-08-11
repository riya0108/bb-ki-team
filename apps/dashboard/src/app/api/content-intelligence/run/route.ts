import { NextResponse } from 'next/server';
import { SynthesizeContentStrategyTaskPayloadSchema } from '@ai-company/shared-types';
import { startWorkflowRun } from '@/lib/workflowApi';

export const runtime = 'nodejs';

/**
 * Starts the content-strategy search — the 4th, convergence engine of
 * Content Intelligence. Takes whatever blogCandidates/youtubeSignals/
 * instagramSignals results the caller already gathered from the 3
 * independent searches (blog-topic-finder, youtube-viral-finder,
 * instagram-viral-finder — each has its own run route under
 * apps/dashboard/src/app/api/content-intelligence), rather than running
 * all 4 automatically.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = SynthesizeContentStrategyTaskPayloadSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await startWorkflowRun('content-intelligence', parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
