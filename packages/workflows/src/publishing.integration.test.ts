try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createContentItem, recordApproval, submitForReview } from './ledger.js';
import {
  ContentNotApprovedError,
  ContentNotScheduledError,
  firePendingSchedule,
  publishDueSchedules,
  requestPublish,
  requestSchedule,
} from './publishing.js';
import type { PublishConnector, ScheduleConnector } from './publishing.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const dnaBody = {
  identity: { role: 'Founder', expertise: [], audiencePrimary: 'x' },
  topics: { primary: [], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
};

describeIfDb('packages/workflows publishing (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  const createdContentIds: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, {
      version: Date.now() % 1_000_000,
      status: 'active',
      body: dnaBody,
    });
    dnaVersion = dna.version;
  });

  afterEach(async () => {
    if (createdContentIds.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [createdContentIds]);
      createdContentIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  async function createApprovedItem(platform = 'linkedin'): Promise<string> {
    const item = await createContentItem(pool, {
      platform,
      createdByAgent: 'agent-01-linkedin',
      mode: 'single_topic',
      contentDnaVersion: dnaVersion,
      text: 'Approved post text.',
    });
    createdContentIds.push(item.id);
    await submitForReview(pool, item.id);
    await recordApproval(pool, item.id, 1, 'riya');
    return item.id;
  }

  it('refuses to publish a draft that has never been approved', async () => {
    const item = await createContentItem(pool, {
      platform: 'linkedin',
      createdByAgent: 'agent-01-linkedin',
      mode: 'single_topic',
      contentDnaVersion: dnaVersion,
      text: 'Unreviewed draft.',
    });
    createdContentIds.push(item.id);

    await expect(requestPublish(pool, item.id, {})).rejects.toBeInstanceOf(ContentNotApprovedError);
  });

  it('records a failed PUBLISH_EVENT and leaves status untouched when no connector is configured', async () => {
    const contentId = await createApprovedItem();

    const { item, event } = await requestPublish(pool, contentId, {});

    expect(item.status).toBe('approved');
    expect(event.result).toBe('failed');
    expect(event.error).toContain('No publish connector');
    expect(event.connector).toBe('none');

    const row = await pool.query<{ status: string }>(
      'SELECT status FROM content_items WHERE id = $1',
      [contentId],
    );
    expect(row.rows[0]?.status).toBe('approved');
  });

  it('publishes through a real connector, transitions to published, and records a success event', async () => {
    const contentId = await createApprovedItem();
    const fakeConnector: PublishConnector = {
      name: 'fake-linkedin-connector',
      publish: () =>
        Promise.resolve({
          platformPostId: 'urn:li:post:123',
          platformUrl: 'https://linkedin.com/post/123',
        }),
    };

    const { item, event } = await requestPublish(pool, contentId, { linkedin: fakeConnector });

    expect(item.status).toBe('published');
    expect(event.result).toBe('success');
    expect(event.platformPostId).toBe('urn:li:post:123');
    expect(event.platformUrl).toBe('https://linkedin.com/post/123');
    expect(event.connector).toBe('fake-linkedin-connector');
  });

  it('never fabricates success when the connector itself fails, and leaves status untouched', async () => {
    const contentId = await createApprovedItem();
    const failingConnector: PublishConnector = {
      name: 'fake-linkedin-connector',
      publish: () => Promise.reject(new Error('LinkedIn API returned 401 Unauthorized')),
    };

    const { item, event } = await requestPublish(pool, contentId, { linkedin: failingConnector });

    expect(item.status).toBe('approved');
    expect(event.result).toBe('failed');
    expect(event.error).toContain('401');

    const row = await pool.query<{ status: string }>(
      'SELECT status FROM content_items WHERE id = $1',
      [contentId],
    );
    expect(row.rows[0]?.status).toBe('approved');
  });

  it('schedules through a real connector and transitions to scheduled', async () => {
    const contentId = await createApprovedItem('x');
    const fakeConnector: ScheduleConnector = {
      name: 'fake-x-scheduler',
      schedule: () => Promise.resolve(),
    };
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000);

    const { item, event } = await requestSchedule(pool, contentId, scheduledFor, {
      x: fakeConnector,
    });

    expect(item.status).toBe('scheduled');
    expect(event.result).toBe('success');
    expect(event.scheduledFor).toBe(scheduledFor.toISOString());
  });

  it('refuses to schedule content that is not approved', async () => {
    const item = await createContentItem(pool, {
      platform: 'x',
      createdByAgent: 'agent-02-x',
      mode: 'single_topic',
      contentDnaVersion: dnaVersion,
      text: 'Unreviewed draft.',
    });
    createdContentIds.push(item.id);

    await expect(requestSchedule(pool, item.id, new Date(), {})).rejects.toBeInstanceOf(
      ContentNotApprovedError,
    );
  });

  async function createScheduledItem(scheduledFor: Date, platform = 'x'): Promise<string> {
    const contentId = await createApprovedItem(platform);
    const noopScheduleConnector: ScheduleConnector = {
      name: 'fake-x-scheduler',
      schedule: () => Promise.resolve(),
    };
    await requestSchedule(pool, contentId, scheduledFor, { [platform]: noopScheduleConnector });
    return contentId;
  }

  it('firePendingSchedule fires a due schedule and transitions it to published', async () => {
    const contentId = await createScheduledItem(new Date(Date.now() - 1000));
    const fakeConnector: PublishConnector = {
      name: 'fake-x-connector',
      publish: () =>
        Promise.resolve({ platformPostId: '123', platformUrl: 'https://x.com/i/web/status/123' }),
    };

    const { item, event } = await firePendingSchedule(pool, contentId, { x: fakeConnector });

    expect(item.status).toBe('published');
    expect(event.result).toBe('success');
    expect(event.platformPostId).toBe('123');
  });

  it('firePendingSchedule refuses content that is not scheduled', async () => {
    const contentId = await createApprovedItem();
    await expect(firePendingSchedule(pool, contentId, {})).rejects.toBeInstanceOf(
      ContentNotScheduledError,
    );
  });

  it('publishDueSchedules fires everything due and leaves not-yet-due items alone', async () => {
    const dueId = await createScheduledItem(new Date(Date.now() - 1000));
    const notYetDueId = await createScheduledItem(new Date(Date.now() + 60 * 60 * 1000));
    const fakeConnector: PublishConnector = {
      name: 'fake-x-connector',
      publish: () =>
        Promise.resolve({ platformPostId: 'abc', platformUrl: 'https://x.com/i/web/status/abc' }),
    };

    const outcomes = await publishDueSchedules(pool, { x: fakeConnector }, new Date());
    const outcomeIds = outcomes.map((outcome) => outcome.item.id);

    expect(outcomeIds).toContain(dueId);
    expect(outcomeIds).not.toContain(notYetDueId);

    const dueRow = await pool.query<{ status: string }>(
      'SELECT status FROM content_items WHERE id = $1',
      [dueId],
    );
    expect(dueRow.rows[0]?.status).toBe('published');

    const notYetDueRow = await pool.query<{ status: string }>(
      'SELECT status FROM content_items WHERE id = $1',
      [notYetDueId],
    );
    expect(notYetDueRow.rows[0]?.status).toBe('scheduled');
  });

  // Regression: firing logs a NEW publish_event row rather than updating the
  // scheduling row's published_at (attemptPublish always inserts) — a query that
  // only checked published_at on the scheduling event itself would see it as still
  // null forever and keep re-offering an already-published item as "due" on every
  // subsequent tick.
  it('does not keep offering an item as due after it has already been fired', async () => {
    const contentId = await createScheduledItem(new Date(Date.now() - 1000));
    const fakeConnector: PublishConnector = {
      name: 'fake-x-connector',
      publish: () =>
        Promise.resolve({ platformPostId: 'xyz', platformUrl: 'https://x.com/i/web/status/xyz' }),
    };

    const first = await publishDueSchedules(pool, { x: fakeConnector }, new Date());
    expect(first.map((outcome) => outcome.item.id)).toContain(contentId);

    const second = await publishDueSchedules(pool, { x: fakeConnector }, new Date());
    expect(second.map((outcome) => outcome.item.id)).not.toContain(contentId);
  });
});
