import { NextResponse } from 'next/server';
import { listPipelineRuns } from '@/lib/pipelineRuns';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const runs = await listPipelineRuns(['content-intelligence']);
  return NextResponse.json({ runs });
}
