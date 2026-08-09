import { NextResponse } from 'next/server';
import { listResearchRuns } from '@/lib/runStore';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const runs = await listResearchRuns();
  return NextResponse.json({ runs });
}
