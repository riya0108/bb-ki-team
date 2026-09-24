import { createFakeLlmClient } from '@bb/core/testing';
import type { ContentDnaRecord } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { draftXPost } from './draftPost.js';

const dna: ContentDnaRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  version: 1,
  status: 'active',
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: ['UPI'], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: ['revolutionary'] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
  createdAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  confirmedBy: 'riya',
};

describe('draftXPost', () => {
  it('sends X-native principles and the Content DNA to the LLM', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const llm = createFakeLlmClient((input) => {
      capturedSystem = input.system ?? '';
      capturedUser = input.messages[0]?.content ?? '';
      return JSON.stringify({
        mode: 'single',
        hookOptions: ['Everyone got UPI wrong.'],
        finalCopy: 'A sharp single post.',
        threadPosts: null,
        factCheckStatus: 'Opinion.',
      });
    });

    const result = await draftXPost({
      topic: 'UPI adoption',
      angle: 'Merchant fees are the real story',
      sourceTexts: [],
      contentDna: dna,
      llm,
      runId: 'test-run',
      stepId: 'draft-test',
    });

    expect(result.mode).toBe('single');
    expect(capturedSystem).toContain('X-native principles');
    expect(capturedSystem).toContain('revolutionary');
    expect(capturedUser).toContain('UPI adoption');
  });

  it('asks for hashtags and defaults to an empty list when the model omits them', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const llm = createFakeLlmClient((input) => {
      capturedSystem = input.system ?? '';
      capturedUser = input.messages[0]?.content ?? '';
      return JSON.stringify({
        mode: 'single',
        hookOptions: ['hook'],
        finalCopy: 'A sharp single post.',
        threadPosts: null,
        factCheckStatus: 'Opinion.',
      });
    });

    const result = await draftXPost({
      topic: 'UPI adoption',
      angle: 'Merchant fees are the real story',
      sourceTexts: [],
      contentDna: dna,
      llm,
      runId: 'test-run',
      stepId: 'draft-test',
    });

    expect(capturedSystem).toContain('Hashtag selection');
    expect(capturedUser).toContain('hashtags');
    expect(result.hashtags).toEqual([]);
  });

  it('passes through model-chosen hashtags as-is — capping to MAX_X_HASHTAGS is appendHashtags\' job', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        mode: 'single',
        hookOptions: ['hook'],
        finalCopy: 'A sharp single post.',
        threadPosts: null,
        factCheckStatus: 'Opinion.',
        hashtags: ['#Markets', '#Fintech', '#UPI'],
      }),
    );

    const result = await draftXPost({
      topic: 'UPI adoption',
      angle: 'Merchant fees are the real story',
      sourceTexts: [],
      contentDna: dna,
      llm,
      runId: 'test-run',
      stepId: 'draft-test',
    });

    expect(result.hashtags).toEqual(['#Markets', '#Fintech', '#UPI']);
  });

  it('forces mode to single and nulls threadPosts when forceMode=single is disobeyed', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        mode: 'thread',
        hookOptions: ['hook'],
        finalCopy: 'first post',
        threadPosts: ['first post', 'second post'],
        factCheckStatus: 'ok',
      }),
    );

    const result = await draftXPost({
      topic: 'UPI adoption',
      angle: 'An angle',
      sourceTexts: [],
      contentDna: dna,
      llm,
      runId: 'test-run',
      stepId: 'draft-test',
      forceMode: 'single',
    });

    expect(result.mode).toBe('single');
    expect(result.threadPosts).toBeNull();
  });

  it('forces mode to thread and backfills threadPosts when forceMode=thread is disobeyed', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        mode: 'single',
        hookOptions: ['hook'],
        finalCopy: 'a single post pretending the topic needs a thread',
        threadPosts: null,
        factCheckStatus: 'ok',
      }),
    );

    const result = await draftXPost({
      topic: 'UPI adoption',
      angle: 'An angle',
      sourceTexts: [],
      contentDna: dna,
      llm,
      runId: 'test-run',
      stepId: 'draft-test',
      forceMode: 'thread',
    });

    expect(result.mode).toBe('thread');
    expect(result.threadPosts).toEqual(['a single post pretending the topic needs a thread']);
  });
});
