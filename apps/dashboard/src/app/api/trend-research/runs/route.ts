import { NextResponse } from 'next/server';
import { listTrendResearchRuns } from '@/lib/workflowRuns';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const runs = await listTrendResearchRuns();
  return NextResponse.json({ runs });
}
