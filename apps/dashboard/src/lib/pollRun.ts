interface PolledRunBody {
  run: {
    status: 'queued' | 'running' | 'succeeded' | 'failed';
    output: unknown;
    error: string | null;
  };
}

function isPolledRunBody(body: unknown): body is PolledRunBody {
  return typeof body === 'object' && body !== null && 'run' in body;
}

/** Client-side poll against this dashboard's own run-status proxy route (e.g. /api/research/run/[runId]) until done. */
export async function pollRun(
  statusUrl: string,
  { intervalMs = 1500, timeoutMs = 120_000 } = {},
): Promise<unknown> {
  const start = Date.now();
  for (;;) {
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
    if (Date.now() - start > timeoutMs)
      throw new Error('Timed out waiting for the run to complete');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
