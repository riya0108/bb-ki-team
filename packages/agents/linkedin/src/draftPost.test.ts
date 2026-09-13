import { createFakeLlmClient } from '@bb/core/testing';
import type { ContentDnaRecord } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { draftLinkedinPost } from './draftPost.js';

const dna: ContentDnaRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  version: 1,
  status: 'active',
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: ['UPI'], secondary: [], avoid: ['politics'] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: ['revolutionary'] },
  storytelling: { hookPatterns: ['contrarian question'], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
  createdAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  confirmedBy: 'riya',
};

const fakeDraftJson = JSON.stringify({
  hookOptions: ['Everyone got UPI wrong.'],
  finalPost: 'HOOK\nCONTEXT\nINSIGHT\nMECHANISM\nEXAMPLE\nSO WHAT\nCLOSE',
  visualSuggestion: 'A chart of UPI volume growth.',
  firstCommentOptional: null,
  factCheckStatus: 'Volume figure is sourced; interpretation is opinion.',
  originalityStatus: 'Disagrees with the source article\'s conclusion.',
});

describe('draftLinkedinPost', () => {
  it('sends the Content DNA, brand rules and post structure to the LLM, and parses its structured output', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const llm = createFakeLlmClient((input) => {
      capturedSystem = input.system ?? '';
      capturedUser = input.messages[0]?.content ?? '';
      return fakeDraftJson;
    });

    const result = await draftLinkedinPost({
      topic: 'UPI adoption',
      angle: 'UPI growth is masking a merchant-fee problem',
      coreClaim: 'UPI processed record volume last quarter',
      sourceTexts: ['UPI processed 15 billion transactions last quarter.'],
      contentDna: dna,
      llm,
      runId: 'test-run',
      stepId: 'draft-test',
    });

    expect(result.finalPost).toContain('HOOK');
    expect(result.hookOptions).toEqual(['Everyone got UPI wrong.']);

    expect(capturedSystem).toContain('Founder');
    expect(capturedSystem).toContain('revolutionary');
    expect(capturedSystem).toContain('THE HOOK: one sentence that interrupts scrolling');
    expect(capturedUser).toContain('UPI adoption');
    expect(capturedUser).toContain('UPI processed 15 billion transactions');
  });

  it('tells the model no source material was supplied when sourceTexts is empty', async () => {
    let capturedUser = '';
    const llm = createFakeLlmClient((input) => {
      capturedUser = input.messages[0]?.content ?? '';
      return fakeDraftJson;
    });

    await draftLinkedinPost({
      topic: 'UPI adoption',
      angle: 'An opinion take',
      sourceTexts: [],
      contentDna: dna,
      llm,
      runId: 'test-run',
      stepId: 'draft-test',
    });

    expect(capturedUser).toContain('no source material supplied');
  });
});
