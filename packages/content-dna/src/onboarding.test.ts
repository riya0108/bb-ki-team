import { createFakeLlmClient } from '@bb/core/testing';
import { describe, expect, it } from 'vitest';

import { buildOnboardingDraft } from './onboarding.js';

describe('buildOnboardingDraft', () => {
  it('returns a populated draft when the fake LLM has enough to work with', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        identity: { role: 'Fintech founder', expertise: ['payments'], audiencePrimary: 'Indian professionals' },
        voice: { tone: 'sharp' },
        pendingQuestions: [],
      }),
    );

    const draft = await buildOnboardingDraft(llm, ['A long sample about UPI payments...']);
    expect(draft.identity?.role).toBe('Fintech founder');
    expect(draft.pendingQuestions).toEqual([]);
  });

  it('surfaces pendingQuestions instead of guessing when samples are thin', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        pendingQuestions: ['Who is your primary audience?', 'What topics do you want to avoid?'],
      }),
    );

    const draft = await buildOnboardingDraft(llm, []);
    expect(draft.identity).toBeUndefined();
    expect(draft.pendingQuestions.length).toBeGreaterThan(0);
  });

  it('passes explicit answers through to the prompt', async () => {
    let capturedPrompt = '';
    const llm = createFakeLlmClient((input) => {
      capturedPrompt = input.messages.map((m) => m.content).join('\n');
      return JSON.stringify({ pendingQuestions: [] });
    });

    await buildOnboardingDraft(llm, [], { 'What is your role?': 'Founder' });
    expect(capturedPrompt).toContain('Founder');
  });
});
