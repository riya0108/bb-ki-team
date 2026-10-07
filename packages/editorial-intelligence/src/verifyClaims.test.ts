import type { Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import type { EvidenceTier, EvidenceSourceKind } from '@bb/shared-types';
import { buildClaimFixture } from '@bb/shared-types/testing';
import { describe, expect, it } from 'vitest';

import type { ResearchDocument } from './research/researchStory.js';
import { detectNumericConflicts, quoteOccursIn, verifyClaims } from './verifyClaims.js';

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

function doc(id: string, text: string, tier: EvidenceTier, kind: EvidenceSourceKind = 'fetched_article', publisher = id): ResearchDocument {
  return {
    source: { id, kind, url: `https://example.com/${id}`, title: null, publisher, tier, publishedAt: null, fetchedAt: null },
    text,
  };
}

function unverified(id: string, text: string, quote: string, sourceId: string) {
  return buildClaimFixture(id, text, {
    verificationStatus: 'UNVERIFIED',
    evidence: [{ sourceId, quote, quoteFound: false }],
    sourceIds: [sourceId],
  });
}

const allYes = createFakeLlmClient((input) => {
  const ids = [...new Set((input.messages[0]?.content ?? '').match(/c\d/g) ?? [])];
  return JSON.stringify({ verdicts: ids.map((claimId) => ({ claimId, supported: 'yes' })) });
});

describe('quoteOccursIn', () => {
  it('matches verbatim quotes across quote-mark and whitespace differences', () => {
    expect(quoteOccursIn('the first increase since  February 2023', 'It was “the first increase since February 2023”.')).toBe(true);
  });

  it('rejects a quote whose numbers differ from the document', () => {
    expect(quoteOccursIn('raised the repo rate by 50 basis points to 5.75 per cent', 'raised the repo rate by 25 basis points to 5.50 per cent')).toBe(false);
  });
});

describe('verifyClaims', () => {
  it('VERIFIES a claim backed by a primary source', async () => {
    const docs = [doc('s1', 'The MPC voted to raise the repo rate by 25 basis points to 5.50 per cent.', 'primary')];
    const [claim] = await verifyClaims({
      claims: [unverified('c1', 'RBI raised the repo rate by 25 basis points.', 'raise the repo rate by 25 basis points', 's1')],
      documents: docs,
      llm: allYes,
      logger: noopLogger,
      runId: 'r',
    });
    expect(claim?.verificationStatus).toBe('VERIFIED');
    expect(claim?.evidence[0]?.quoteFound).toBe(true);
  });

  it('caps a claim supported only by one search snippet below VERIFIED, whatever the model says', async () => {
    const docs = [doc('s1', 'RBI hikes repo rate by 25 basis points', 'secondary', 'news_search_result', 'Reuters')];
    const [claim] = await verifyClaims({
      claims: [unverified('c1', 'RBI raised the repo rate by 25 basis points.', 'RBI hikes repo rate by 25 basis points', 's1')],
      documents: docs,
      llm: allYes,
      logger: noopLogger,
      runId: 'r',
    });
    expect(claim?.verificationStatus).not.toBe('VERIFIED');
    expect(claim?.verificationStatus).not.toBe('HIGH_CONFIDENCE');
  });

  it('never marks a claim verified when its cited quote is not in the document', async () => {
    const docs = [doc('s1', 'Completely unrelated text about cricket scores and weather.', 'primary')];
    const [claim] = await verifyClaims({
      claims: [unverified('c1', 'RBI raised the repo rate.', 'RBI raised the repo rate by 25 basis points', 's1')],
      documents: docs,
      llm: allYes,
      logger: noopLogger,
      runId: 'r',
    });
    expect(claim?.verificationStatus).toBe('UNVERIFIED');
  });

  it('marks every claim UNVERIFIED when the verifier call fails (spec 44)', async () => {
    const docs = [doc('s1', 'The MPC voted to raise the repo rate by 25 basis points.', 'primary')];
    const [claim] = await verifyClaims({
      claims: [unverified('c1', 'RBI raised the repo rate by 25 basis points.', 'raise the repo rate by 25 basis points', 's1')],
      documents: docs,
      llm: createFakeLlmClient(() => 'not json'),
      logger: noopLogger,
      runId: 'r',
    });
    expect(claim?.verificationStatus).toBe('UNVERIFIED');
  });

  it('marks a contradicted user-supplied fact FALSE and a temporal error PARTIALLY_VERIFIED', async () => {
    const docs = [doc('s1', 'This is the first increase in the repo rate since February 2023.', 'primary')];
    const llm = createFakeLlmClient(() =>
      JSON.stringify({
        verdicts: [
          { claimId: 'c1', supported: 'contradicted' },
          { claimId: 'c2', supported: 'yes', temporalContextCorrect: false },
        ],
      }),
    );
    const userClaim = { ...unverified('c1', 'RBI hiked rates again.', 'first increase in the repo rate', 's1'), origin: 'user' as const };
    const claims = await verifyClaims({
      claims: [userClaim, unverified('c2', 'RBI has been hiking every quarter since 2023.', 'first increase in the repo rate since February 2023', 's1')],
      documents: docs,
      llm,
      logger: noopLogger,
      runId: 'r',
    });
    expect(claims[0]?.verificationStatus).toBe('FALSE');
    expect(claims[1]?.verificationStatus).toBe('PARTIALLY_VERIFIED');
  });

  it('marks conflicting secondary-source numbers DISPUTED instead of silently merging them', async () => {
    const docs = [
      doc('s1', 'The central bank raised the repo rate by 25 basis points on Wednesday.', 'secondary', 'fetched_article', 'Reuters'),
      doc('s2', 'The central bank raised the repo rate by 50 basis points on Wednesday.', 'secondary', 'fetched_article', 'Mint'),
    ];
    const claims = await verifyClaims({
      claims: [
        unverified('c1', 'The central bank raised the repo rate by 25 basis points.', 'raised the repo rate by 25 basis points', 's1'),
        unverified('c2', 'The central bank raised the repo rate by 50 basis points.', 'raised the repo rate by 50 basis points', 's2'),
      ],
      documents: docs,
      llm: allYes,
      logger: noopLogger,
      runId: 'r',
    });
    expect(claims.map((c) => c.verificationStatus)).toEqual(['DISPUTED', 'DISPUTED']);
    expect(claims[0]?.conflictingClaimIds).toEqual(['c2']);
  });

  it('detectNumericConflicts ignores claims about different things', () => {
    expect(
      detectNumericConflicts([
        buildClaimFixture('a', 'Repo rate rose 25 basis points.'),
        buildClaimFixture('b', 'Inflation eased 40 basis points in September.'),
      ]),
    ).toEqual([]);
  });
});
