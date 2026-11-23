try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { Logger } from '@bb/core';
import type { Pool } from '@bb/db';
import { claimNextAgentJob, completeAgentJob, createChatSession, createPool, enqueueAgentJob, getAgentJob, listChatMessages } from '@bb/db';
import type { AgentJob } from '@bb/shared-types';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { BlogAgentDeps } from './blogDeps.js';
import type { AppDeps } from './deps.js';
import { BLOG_JOB_MAX_ATTEMPTS, BLOG_JOB_STALE_AFTER_MS, processNextBlogJob } from './blogJobs.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

describeIfDb('Blog job queue (integration, real Postgres)', () => {
  let pool: Pool;
  let sessionId: string;
  const sessionIds: string[] = [];
  const agentDeps = {} as BlogAgentDeps;

  beforeAll(() => {
    pool = createPool(databaseUrl ?? '');
  });

  beforeEach(async () => {
    // Isolate from anything an earlier run left in the test database's blog queue.
    await pool.query(`DELETE FROM agent_jobs WHERE platform = 'blog'`);
    sessionId = (await createChatSession(pool, 'blog')).id;
    sessionIds.push(sessionId);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM agent_jobs WHERE platform = 'blog'`);
    await pool.query('DELETE FROM chat_sessions WHERE id = ANY($1::uuid[])', [sessionIds]);
    await pool.end();
  });

  function enqueue(message = 'Write a blog on UPI fees') {
    return enqueueAgentJob(pool, { platform: 'blog', kind: 'chat', sessionId, runId: randomUUID(), payload: { message, openContentId: null } });
  }

  it('returns false on an empty queue', async () => {
    expect(await processNextBlogJob({ pool, logger: noopLogger, agentDeps, workerId: 'w1', runChat: vi.fn() })).toBe(false);
  });

  it('runs a queued chat message with the already-recorded flag and stores the reply', async () => {
    const job = await enqueue();
    const runChat = vi.fn().mockResolvedValue({ reply: 'Drafted it.', action: 'draft', result: { contentId: 'c1' } });

    expect(await processNextBlogJob({ pool, logger: noopLogger, agentDeps, workerId: 'w1', runChat })).toBe(true);

    expect(runChat).toHaveBeenCalledWith(agentDeps, 'Write a blog on UPI fees', { sessionId, openContentId: null }, job.runId, { userMessageRecorded: true });
    const done = await getAgentJob(pool, job.id);
    expect(done?.status).toBe('done');
    expect(done?.result).toEqual({ reply: 'Drafted it.', action: 'draft', result: { contentId: 'c1' } });
    expect(done?.finishedAt).not.toBeNull();
  });

  it('records the error when the agent fails', async () => {
    const job = await enqueue();
    const runChat = vi.fn().mockRejectedValue(new Error('All configured LLM providers failed'));
    await processNextBlogJob({ pool, logger: noopLogger, agentDeps, workerId: 'w1', runChat });
    const failed = await getAgentJob(pool, job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('All configured LLM providers failed');
  });

  it('never hands the same job to two workers', async () => {
    await enqueue();
    const options = { platform: 'blog', staleAfterMs: BLOG_JOB_STALE_AFTER_MS, maxAttempts: BLOG_JOB_MAX_ATTEMPTS };
    const [a, b] = await Promise.all([claimNextAgentJob(pool, { ...options, workerId: 'a' }), claimNextAgentJob(pool, { ...options, workerId: 'b' })]);
    expect([a, b].filter((j) => j !== null)).toHaveLength(1);
  });

  it('retries a job whose worker went silent, and ignores the stalled worker finishing late', async () => {
    const job = await enqueue();
    const options = { platform: 'blog', staleAfterMs: BLOG_JOB_STALE_AFTER_MS, maxAttempts: BLOG_JOB_MAX_ATTEMPTS };
    await claimNextAgentJob(pool, { ...options, workerId: 'sleepy-mac' });
    await pool.query(`UPDATE agent_jobs SET heartbeat_at = now() - interval '1 hour' WHERE id = $1`, [job.id]);

    const reclaimed = await claimNextAgentJob(pool, { ...options, workerId: 'awake-mac' });
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed?.attempts).toBe(2);
    expect(await completeAgentJob(pool, job.id, 'sleepy-mac', { reply: 'late' })).toBe(false);
    expect(await completeAgentJob(pool, job.id, 'awake-mac', { reply: 'on time' })).toBe(true);
  });

  it('fails a silent job once it has used every attempt', async () => {
    const job = await enqueue();
    await pool.query(
      `UPDATE agent_jobs SET status = 'running', attempts = $2, worker_id = 'gone', heartbeat_at = now() - interval '1 hour' WHERE id = $1`,
      [job.id, BLOG_JOB_MAX_ATTEMPTS],
    );
    expect(await processNextBlogJob({ pool, logger: noopLogger, agentDeps, workerId: 'w1', runChat: vi.fn() })).toBe(false);
    const failed = await getAgentJob(pool, job.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toMatch(/stopped responding/);
  });
});

describeIfDb('POST /blog/chat in queue mode (integration, real Postgres)', () => {
  let pool: Pool;
  let baseUrl: string;
  let close: () => Promise<void>;
  let sessionId: string;
  const llm = { complete: vi.fn(), completeStructured: vi.fn() };

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    await pool.query(`DELETE FROM agent_jobs WHERE platform = 'blog'`);
    sessionId = (await createChatSession(pool, 'blog')).id;
    const deps = {
      env: { databaseUrl: databaseUrl ?? '', apiPort: 0, apiHost: '127.0.0.1', visualAgentEnabled: false, blogChatMode: 'queue' },
      pool,
      llm,
      logger: noopLogger,
      publishConnectors: {},
      scheduleConnectors: {},
    } as unknown as AppDeps;
    const server = createApp(deps).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => {
    await close();
    await pool.query('DELETE FROM chat_sessions WHERE id = $1', [sessionId]);
    await pool.end();
  });

  it('records the message, queues it without touching the LLM, and lets the dashboard poll and resume it', async () => {
    const response = await fetch(`${baseUrl}/blog/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Write a blog on gold ETFs', sessionId }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { queued: boolean; job: AgentJob };
    expect(body.queued).toBe(true);
    expect(body.job.status).toBe('queued');
    expect(body.job.payload).toEqual({ message: 'Write a blog on gold ETFs', openContentId: null });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(llm.completeStructured).not.toHaveBeenCalled();

    const history = await listChatMessages(pool, sessionId);
    expect(history.map((m) => [m.role, m.content])).toEqual([['user', 'Write a blog on gold ETFs']]);

    const polled = (await (await fetch(`${baseUrl}/blog/jobs/${body.job.id}`)).json()) as { job: AgentJob };
    expect(polled.job.id).toBe(body.job.id);
    expect((await fetch(`${baseUrl}/blog/jobs/${randomUUID()}`)).status).toBe(404);

    const reopened = (await (await fetch(`${baseUrl}/blog/chat`)).json()) as { sessionId: string; pendingJob: AgentJob | null };
    if (reopened.sessionId === sessionId) expect(reopened.pendingJob?.id).toBe(body.job.id);
  });
});
