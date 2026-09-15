import type { ContentItem } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { tweetsForItem } from './xClient.js';

function baseItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    platform: 'x',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByAgent: 'agent-x',
    mode: 'single_topic',
    topic: 'AI regulation',
    contentPillar: null,
    sourceIds: [],
    sourceUrls: [],
    coreClaim: null,
    angle: null,
    contentDnaVersion: 1,
    currentVersion: 1,
    currentText: 'a single post',
    status: 'approved',
    riskLevel: 'low',
    approvedVersion: 1,
    approvedAt: new Date().toISOString(),
    approvedBy: 'user',
    package: null,
    ...overrides,
  };
}

describe('tweetsForItem', () => {
  it('posts currentText as a single tweet when there is no package', () => {
    const item = baseItem();
    expect(tweetsForItem(item)).toEqual(['a single post']);
  });

  it('posts currentText as a single tweet when threadPosts is null', () => {
    const item = baseItem({ package: { threadPosts: null, finalCopy: 'a single post' } });
    expect(tweetsForItem(item)).toEqual(['a single post']);
  });

  it('posts each threadPosts entry in order for a thread', () => {
    const item = baseItem({
      mode: 'thread',
      package: { threadPosts: ['one', 'two', 'three'] },
    });
    expect(tweetsForItem(item)).toEqual(['one', 'two', 'three']);
  });

  it('falls back to currentText when threadPosts is an empty array', () => {
    const item = baseItem({ package: { threadPosts: [] } });
    expect(tweetsForItem(item)).toEqual(['a single post']);
  });
});
