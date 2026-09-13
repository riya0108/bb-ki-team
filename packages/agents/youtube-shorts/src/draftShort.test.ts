import { createFakeLlmClient } from '@bb/core/testing';
import type { ContentDnaRecord } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { draftYoutubeShort } from './draftShort.js';

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

describe('draftYoutubeShort', () => {
  it('sends Shorts-specific optimisation rules and the retention QA test to the LLM', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const llm = createFakeLlmClient((input) => {
      capturedSystem = input.system ?? '';
      capturedUser = input.messages[0]?.content ?? '';
      return JSON.stringify({
        corePromise: 'Learn who pays UPI fees.',
        hookOptions: ['hook'],
        titleOptions: ['title'],
        spokenScript: 'This is the script.',
        visualBeats: ['beat 1'],
        onScreenText: [],
        bRoll: [],
        editingPacing: null,
        description: 'desc',
        cta: null,
      });
    });

    const result = await draftYoutubeShort({
      topic: 'UPI fees',
      angle: 'Who actually pays',
      sourceTexts: [],
      contentDna: dna,
      llm,
      runId: 'test-run',
      stepId: 'draft-test',
    });

    expect(result.spokenScript).toBe('This is the script.');
    expect(capturedSystem).toContain('Shorts-specific optimisation');
    expect(capturedSystem).toContain('retention QA');
    expect(capturedSystem).toContain('revolutionary');
    expect(capturedUser).toContain('UPI fees');
  });
});
