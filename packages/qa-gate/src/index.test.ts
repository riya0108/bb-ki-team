import { createFakeLlmClient } from '@bb/core/testing';
import type { ContentDnaRecord } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { runQaGate } from './index.js';

const dna: ContentDnaRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  status: 'active',
  identity: { role: 'Founder', expertise: [], audiencePrimary: 'professionals' },
  topics: { primary: [], secondary: [], avoid: [] },
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

const passingRubricResponse = JSON.stringify({ status: 'PASS', notes: 'looks good' });

describe('runQaGate', () => {
  it('folds platform-specific checks into the overall status and stores them', async () => {
    const llm = createFakeLlmClient(() => passingRubricResponse);
    const input = {
      finalPost: 'A clean, plain sentence about markets. No tricks here.',
      sourceReferences: [],
      sourceTexts: [],
      contentDna: dna,
      status: 'in_review' as const,
      llm,
      runId: 'run-1',
      stepId: 'step-1',
      platform: 'Blog article',
    };
    const warned = await runQaGate({ ...input, platformChecks: { seo: { status: 'WARN', notes: 'no keyword' } } });
    expect(warned.overallStatus).toBe('PASS_WITH_WARNINGS');
    expect(warned.platformChecks?.seo?.status).toBe('WARN');
    expect(warned.requiredUserActions).toContain('platform.seo: no keyword');

    const blocked = await runQaGate({ ...input, platformChecks: { editorial_critic: { status: 'FAIL', notes: 'below the bar' } } });
    expect(blocked.overallStatus).toBe('BLOCKED');
    expect(blocked.publishAllowed).toBe(false);

    const none = await runQaGate(input);
    expect(none.platformChecks).toBeUndefined();
  });

  it('returns PASS with publishAllowed=false when everything passes', async () => {
    const llm = createFakeLlmClient(() => passingRubricResponse);
    const result = await runQaGate({
      finalPost: 'A clean, plain sentence about markets. No tricks here.',
      sourceReferences: [],
      sourceTexts: [],
      contentDna: dna,
      status: 'in_review',
      llm,
      runId: 'run-1',
      stepId: 'step-1',
      platform: 'LinkedIn',
    });

    expect(result.overallStatus).toBe('PASS');
    expect(result.publishAllowed).toBe(false);
  });

  it('is BLOCKED when the draft contains an em dash, regardless of rubric results', async () => {
    const llm = createFakeLlmClient(() => passingRubricResponse);
    const result = await runQaGate({
      finalPost: 'This is bad — very bad.',
      sourceReferences: [],
      sourceTexts: [],
      contentDna: dna,
      status: 'in_review',
      llm,
      runId: 'run-1',
      stepId: 'step-1',
      platform: 'LinkedIn',
    });

    expect(result.overallStatus).toBe('BLOCKED');
    expect(result.voiceMatch.status).toBe('FAIL');
  });

  it('is BLOCKED when a rubric dimension fails', async () => {
    const llm = createFakeLlmClient((input) => {
      // Fail specifically the platform-fit call (identified by its system prompt) so
      // this is deterministic regardless of Promise.all call ordering.
      const isPlatformFitCall = input.system?.includes('native to LinkedIn') ?? false;
      return isPlatformFitCall
        ? JSON.stringify({ status: 'FAIL', notes: 'not native to platform' })
        : passingRubricResponse;
    });
    const result = await runQaGate({
      finalPost: 'A clean, plain sentence about markets. No tricks here.',
      sourceReferences: [],
      sourceTexts: [],
      contentDna: dna,
      status: 'in_review',
      llm,
      runId: 'run-1',
      stepId: 'step-1',
      platform: 'LinkedIn',
    });

    expect(result.overallStatus).toBe('BLOCKED');
  });

  it('flags high-risk topics in riskFlags', async () => {
    const llm = createFakeLlmClient(() => passingRubricResponse);
    const result = await runQaGate({
      finalPost: 'This mutual fund investment promises huge returns, invest now.',
      sourceReferences: ['https://example.com'],
      sourceTexts: [],
      contentDna: dna,
      status: 'in_review',
      llm,
      runId: 'run-1',
      stepId: 'step-1',
      platform: 'LinkedIn',
    });

    expect(result.riskFlags).toContain('financial_claims');
  });

  it('passes the given platform into the rubric prompts, never hardcoding LinkedIn', async () => {
    const systemPrompts: string[] = [];
    const llm = createFakeLlmClient((input) => {
      systemPrompts.push(input.system ?? '');
      return passingRubricResponse;
    });

    await runQaGate({
      finalPost: 'A thread-native post about markets.',
      sourceReferences: [],
      sourceTexts: [],
      contentDna: dna,
      status: 'in_review',
      llm,
      runId: 'run-1',
      stepId: 'step-1',
      platform: 'X',
    });

    expect(systemPrompts.some((p) => p.includes('X'))).toBe(true);
    expect(systemPrompts.some((p) => p.includes('LinkedIn'))).toBe(false);
  });
});
