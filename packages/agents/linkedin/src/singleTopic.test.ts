import { createFakeLlmClient } from '@bb/core/testing';
import type { ContentDnaRecord } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { proposeLinkedinAngles } from './singleTopic.js';

const dna: ContentDnaRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  version: 1,
  status: 'active',
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: [], secondary: [], avoid: [] },
  opinions: { stronglyHeld: ['UPI fees should stay zero'], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
  createdAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  confirmedBy: 'riya',
};

describe('proposeLinkedinAngles', () => {
  it('returns the angles parsed from the LLM response', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        angles: [
          { angle: 'Merchant fees are the real story', description: 'Focus on who pays for UPI infra.' },
          { angle: 'UPI as industrial policy', description: 'Frame UPI as a state-led bet, not just a product.' },
        ],
      }),
    );

    const angles = await proposeLinkedinAngles('UPI adoption', dna, llm, 'test-run');

    expect(angles).toHaveLength(2);
    expect(angles[0]?.angle).toBe('Merchant fees are the real story');
  });

  it('sends the topic and the creator\'s strongly held opinions to the LLM', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const llm = createFakeLlmClient((input) => {
      capturedSystem = input.system ?? '';
      capturedUser = input.messages[0]?.content ?? '';
      return JSON.stringify({ angles: [{ angle: 'a', description: 'b' }] });
    });

    await proposeLinkedinAngles('UPI adoption', dna, llm, 'test-run');

    expect(capturedSystem).toContain('UPI fees should stay zero');
    expect(capturedUser).toContain('UPI adoption');
  });
});
