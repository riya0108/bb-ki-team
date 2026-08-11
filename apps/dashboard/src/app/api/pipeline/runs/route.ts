import { NextResponse } from 'next/server';
import { listPipelineRuns } from '@/lib/pipelineRuns';

export const runtime = 'nodejs';

/** Cross-workflow feed for the shared downstream stages (Research Agent, Content, Blog Agent) — both front doors converge here. */
export async function GET(): Promise<Response> {
  const runs = await listPipelineRuns(['blog', 'content-intelligence']);
  return NextResponse.json({ runs });
}
