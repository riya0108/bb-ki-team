import { describe, expect, it, vi } from 'vitest';

import type { BufferApiClient, BufferPost } from './bufferApiClient.js';
import { BufferPostFailedError, BufferPostTimeoutError, waitForSent } from './postPolling.js';

function fakeClient(statuses: BufferPost[]): BufferApiClient {
  const queue = [...statuses];
  return {
    listChannels: () => Promise.reject(new Error('not used')),
    createThreadPost: () => Promise.reject(new Error('not used')),
    getPost: () => {
      const next = queue.shift();
      if (!next) throw new Error('fakeClient.getPost called more times than expected');
      return Promise.resolve(next);
    },
  };
}

const noopDelay = () => Promise.resolve();

describe('waitForSent', () => {
  it('returns immediately when the first poll is already sent', async () => {
    const client = fakeClient([{ id: 'p1', status: 'sent', externalLink: 'https://x.com/a/status/1' }]);
    const post = await waitForSent(client, 'p1', { delay: noopDelay });
    expect(post.externalLink).toBe('https://x.com/a/status/1');
  });

  it('polls through intermediate statuses until sent', async () => {
    const client = fakeClient([
      { id: 'p1', status: 'scheduled', externalLink: null },
      { id: 'p1', status: 'scheduled', externalLink: null },
      { id: 'p1', status: 'sent', externalLink: 'https://x.com/a/status/1' },
    ]);
    const post = await waitForSent(client, 'p1', { delay: noopDelay });
    expect(post.status).toBe('sent');
  });

  it('throws BufferPostFailedError on a terminal error status', async () => {
    const client = fakeClient([{ id: 'p1', status: 'error', externalLink: null }]);
    await expect(waitForSent(client, 'p1', { delay: noopDelay })).rejects.toThrow(
      BufferPostFailedError,
    );
  });

  it('throws BufferPostTimeoutError once the deadline passes', async () => {
    const realNow = Date.now;
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockImplementationOnce(() => 1_000)
      .mockImplementationOnce(() => 1_000)
      .mockImplementationOnce(() => 2_000);

    const client = fakeClient([
      { id: 'p1', status: 'scheduled', externalLink: null },
      { id: 'p1', status: 'scheduled', externalLink: null },
    ]);

    await expect(
      waitForSent(client, 'p1', { delay: noopDelay, timeoutMs: 500 }),
    ).rejects.toThrow(BufferPostTimeoutError);

    dateNowSpy.mockRestore();
    expect(Date.now).toBe(realNow);
  });
});
