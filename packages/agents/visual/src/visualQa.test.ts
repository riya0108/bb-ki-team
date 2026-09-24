import { createFakeLlmClient } from '@bb/core/testing';
import { describe, expect, it } from 'vitest';

import { runVisualQa } from './visualQa.js';

const allPass = {
  truthIntegrity: 'PASS',
  evidenceIntegrity: 'PASS',
  identityPrivacy: 'PASS',
  editorialFit: 'PASS',
  platformFit: 'PASS',
  issues: [],
  requiredFixes: [],
  reviewerNotes: 'Looks consistent with the claims.',
};

const baseInput = {
  concept: 'A trader watching a falling chart',
  rationale: 'Shows consequence',
  visualClaims: [
    { claim: 'markets fell today', claimType: 'verified_fact' as const, sourceIds: ['src-1'] },
  ],
  isIllustrative: true,
  disclosureRequired: true,
  runId: 'run-1',
  stepId: 'step-1',
};

describe('runVisualQa', () => {
  it('never returns an automated PASS for visualQuality (no vision model exists in this codebase)', async () => {
    const llm = createFakeLlmClient(() => JSON.stringify(allPass));
    const qa = await runVisualQa({ ...baseInput, llm });
    expect(qa.visualQuality).toBe('NEEDS_REVIEW');
    expect(qa.status).toBe('NEEDS_REVIEW');
  });

  it('fails the whole result when the model flags fabricated evidence', async () => {
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        ...allPass,
        evidenceIntegrity: 'FAIL',
        issues: ['depicts a fake government notice'],
      }),
    );
    const qa = await runVisualQa({ ...baseInput, llm });
    expect(qa.status).toBe('FAIL');
    expect(qa.evidenceIntegrity).toBe('FAIL');
  });

  it('deterministically fails evidenceIntegrity when illustrative but not disclosed, regardless of the model', async () => {
    const llm = createFakeLlmClient(() => JSON.stringify(allPass));
    const qa = await runVisualQa({ ...baseInput, disclosureRequired: false, llm });
    expect(qa.evidenceIntegrity).toBe('FAIL');
    expect(qa.status).toBe('FAIL');
    expect(qa.issues).toContain('Illustrative concept is missing required disclosure metadata.');
  });

  it('flags a high-risk topic in the concept/rationale text', async () => {
    const llm = createFakeLlmClient(() => JSON.stringify(allPass));
    const qa = await runVisualQa({
      ...baseInput,
      concept: 'A minister announcing a new government policy on stock market returns',
      llm,
    });
    expect(qa.issues.some((issue) => issue.startsWith('high-risk topic:'))).toBe(true);
  });
});
