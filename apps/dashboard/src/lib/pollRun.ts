interface PolledRunBody {
  run: {
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
    output: unknown;
    error: string | null;
  };
}

function isPolledRunBody(body: unknown): body is PolledRunBody {
  return typeof body === 'object' && body !== null && 'run' in body;
}

/** Thrown by pollRun when the run was stopped (locally via `signal`, or because the server reports 'cancelled') — callers should treat this as a clean stop, not a failure. */
export class RunCancelledError extends Error {
  constructor(message = 'Run was stopped') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

/**
 * Client-side poll against this dashboard's own run-status proxy route (e.g.
 * /api/research/run/[runId]) until done. Pass `signal` to stop polling
 * immediately when the user clicks "Stop".
 *
 * Default timeout is generous (5 min) because generateStructured (see
 * packages/core/src/llm.ts) retries a failing/rate-limited step across every
 * configured LLM provider before giving up — observed real runs in this repo
 * have taken 160s+ end to end when an earlier provider in the chain errors
 * or is rate-limited. A shorter timeout here surfaced as candidates never
 * arriving (and blocking Content Strategy's approval step, which requires
 * them) even though the run itself went on to succeed seconds later.
 */
export async function pollRun(
  statusUrl: string,
  {
    intervalMs = 1500,
    timeoutMs = 300_000,
    signal,
  }: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  const start = Date.now();
  for (;;) {
    if (signal?.aborted) throw new RunCancelledError();
    const response = await fetch(statusUrl, { cache: 'no-store' });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok || !isPolledRunBody(body)) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Request failed (${String(response.status)})`;
      throw new Error(message);
    }
    if (body.run.status === 'succeeded') return body.run.output;
    if (body.run.status === 'failed') throw new Error(body.run.error ?? 'Workflow run failed');
    if (body.run.status === 'cancelled') throw new RunCancelledError();
    if (signal?.aborted) throw new RunCancelledError();
    if (Date.now() - start > timeoutMs)
      throw new Error('Timed out waiting for the run to complete');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
