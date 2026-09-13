import { createFakeLlmClient } from '@bb/core/testing';
import type { ContentDnaRecord } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { routeInstagramFormat } from './routing.js';

const dna: ContentDnaRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  version: 1,
  status: 'active',
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: ['UPI'], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
  createdAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  confirmedBy: 'riya',
};

describe('routeInstagramFormat', () => {
  it('sends the routing table and topic/angle to the LLM, and returns its decision', async () => {
    let capturedSystem = '';
    let capturedUser = '';
    const llm = createFakeLlmClient((input) => {
      capturedSystem = input.system ?? '';
      capturedUser = input.messages[0]?.content ?? '';
      return JSON.stringify({ format: 'carousel', reasoning: 'Step-by-step explainer fits carousels.' });
    });

    const format = await routeInstagramFormat(
      'How UPI fees actually work',
      'A 5-step breakdown of who takes a cut',
      dna,
      llm,
      'test-run',
    );

    expect(format).toBe('carousel');
    expect(capturedSystem).toContain('Educational sequence');
    expect(capturedUser).toContain('How UPI fees actually work');
  });
});
