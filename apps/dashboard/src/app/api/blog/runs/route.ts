import { NextResponse } from 'next/server';
import { listPipelineRuns } from '@/lib/pipelineRuns';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const runs = await listPipelineRuns(['blog']);
  return NextResponse.json({ runs });
}
