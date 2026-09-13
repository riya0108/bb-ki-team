import { createFakeLlmClient } from '@bb/core/testing';
import type { ContentDnaRecord } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { classifyEditInstruction } from './editInstructionClassifier.js';

const dna: ContentDnaRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  version: 1,
  status: 'active',
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: [], secondary: [], avoid: [] },
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

describe('classifyEditInstruction', () => {
  it('sends the current DNA sections and the instruction to the LLM', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const llm = createFakeLlmClient((input) => {
      capturedSystem = input.system ?? '';
      capturedUser = input.messages[0]?.content ?? '';
      return JSON.stringify({ isVoiceLevelInstruction: false, summary: 'one-off', proposedChange: null });
    });

    await classifyEditInstruction('cut the last paragraph', dna, llm, 'test-run');

    expect(capturedSystem).toContain('revolutionary');
    expect(capturedUser).toContain('cut the last paragraph');
  });

  it('parses a voice-level classification with a proposed patch', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        isVoiceLevelInstruction: true,
        summary: 'Creator never wants exclamation marks.',
        proposedChange: { voice: { forbiddenPhrases: ['revolutionary', '!'] } },
      }),
    );

    const result = await classifyEditInstruction('never use exclamation marks', dna, llm, 'test-run');

    expect(result.isVoiceLevelInstruction).toBe(true);
    expect(result.proposedChange).toEqual({ voice: { forbiddenPhrases: ['revolutionary', '!'] } });
  });

  it('parses a one-off classification with a null patch', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({ isVoiceLevelInstruction: false, summary: 'Content-specific tweak.', proposedChange: null }),
    );

    const result = await classifyEditInstruction('make this about UPI instead', dna, llm, 'test-run');

    expect(result.isVoiceLevelInstruction).toBe(false);
    expect(result.proposedChange).toBeNull();
  });
});
