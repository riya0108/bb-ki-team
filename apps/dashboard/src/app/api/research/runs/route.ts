import { NextResponse } from 'next/server';
import { listResearchRuns } from '@/lib/workflowRuns';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const runs = await listResearchRuns();
  return NextResponse.json({ runs });
}
