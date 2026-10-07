import { createFakeLlmClient } from '@bb/core/testing';
import { buildRbiEditorialBrief, RBI_FIRST_SINCE_CLAIM_ID } from '@bb/shared-types/testing';
import { describe, expect, it } from 'vitest';

import { runEditorialQa } from './editorialQa.js';

const GOOD_DRAFT =
  "RBI just hiked rates for the first time since 2023, and if you have a home or car loan, here's why your EMI could be affected.\n\nThe repo rate went up by 25 basis points to 5.50%.";

function cleanCheck(): string {
  return JSON.stringify({
    materialClaims: [
      { text: 'RBI just hiked rates for the first time since 2023', kind: 'fact', mappedClaimIds: [RBI_FIRST_SINCE_CLAIM_ID] },
      { text: 'The repo rate went up by 25 basis points to 5.50%', kind: 'fact', mappedClaimIds: ['claim_rbi_002'] },
    ],
    issues: [],
    missingProtectedClaimIds: [],
    openingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID],
    crossPlatformIssues: [],
  });
}

async function run(draft: string, llmResponse: () => string, siblingDrafts: { platform: string; text: string }[] = []) {
  return runEditorialQa({
    draft,
    brief: buildRbiEditorialBrief(),
    siblingDrafts,
    platform: 'X',
    llm: createFakeLlmClient(llmResponse),
    runId: 'test-run',
    stepId: 'qa',
  });
}

describe('runEditorialQa', () => {
  it('passes a draft that preserves the protected facts and maps every claim', async () => {
    const result = await run(GOOD_DRAFT, cleanCheck);
    for (const [name, dim] of Object.entries(result)) {
      if (typeof dim === 'string') continue;
      expect(dim.status, `${name}: ${dim.notes}`).toBe('PASS');
    }
  });

  it('RBI regression: "again" fails temporal accuracy and hook traceability even if the LLM says it is fine', async () => {
    const result = await run('RBI just hiked rates again. Your EMI could be affected.', cleanCheck);
    expect(result.temporalAccuracy.status).toBe('FAIL');
    expect(result.hookTraceability.status).toBe('FAIL');
  });

  it('RBI regression: "RBI may hike rates" (past event turned into a possibility) fails', async () => {
    const result = await run('RBI may hike rates soon. Borrowers should watch their EMIs.', cleanCheck);
    expect(result.temporalAccuracy.status).toBe('FAIL');
  });

  it('fails number accuracy when a unit is swapped (25 bps -> 25%)', async () => {
    const result = await run('RBI just hiked rates for the first time since 2023. Rates jumped 25%.', cleanCheck);
    expect(result.numberAccuracy.status).toBe('FAIL');
  });

  it('flags a literal forbidden formulation from thingsNotToSay', async () => {
    const result = await run('Another rate hike is here for the first time since 2023.', cleanCheck);
    expect(result.meaningPreservation.status).toBe('FAIL');
  });

  it('fails meaning preservation on an LLM-reported semantic issue', async () => {
    const result = await run(GOOD_DRAFT, () =>
      JSON.stringify({
        materialClaims: [],
        issues: [{ category: 'meaning', draftText: 'x', claimId: null, explanation: 'Overstates certainty.' }],
        missingProtectedClaimIds: [],
        openingClaimIds: [],
        crossPlatformIssues: [],
      }),
    );
    expect(result.meaningPreservation.status).toBe('FAIL');
  });

  it('never trusts mappings to claim IDs that do not exist in the ledger', async () => {
    const result = await run(GOOD_DRAFT, () =>
      JSON.stringify({
        materialClaims: [{ text: 'Banks will raise rates by Friday', kind: 'fact', mappedClaimIds: ['claim_invented'] }],
        issues: [],
        missingProtectedClaimIds: [],
        openingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID],
        crossPlatformIssues: [],
      }),
    );
    expect(result.claimTraceability.status).not.toBe('PASS');
  });

  it('degrades to WARN (never PASS, never throw) when the semantic check is unavailable', async () => {
    const result = await run(GOOD_DRAFT, () => 'not json');
    expect(result.claimTraceability.status).toBe('WARN');
    expect(result.meaningPreservation.status).toBe('WARN');
  });

  it('flags a sibling platform draft that contradicts the shared brief', async () => {
    const result = await run(GOOD_DRAFT, cleanCheck, [
      { platform: 'LinkedIn', text: 'RBI has resumed its rate-hiking cycle. Here is what that means.' },
    ]);
    expect(result.crossPlatformConsistency.status).toBe('WARN');
  });
});
