import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runResearchAgent } from '@ai-company/agent-research';
import { saveResearchRun } from '@/lib/runStore';

export const runtime = 'nodejs';
export const maxDuration = 120;

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
    const result = await runResearchAgent(parsed.data.query);
    await saveResearchRun(result);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
