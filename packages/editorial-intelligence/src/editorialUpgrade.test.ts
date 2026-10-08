import type { EditorialBrief, EvidenceSourceKind, EvidenceTier } from '@bb/shared-types';
import { EditorialBriefSchema } from '@bb/shared-types';
import { buildClaimFixture } from '@bb/shared-types/testing';
import { describe, expect, it } from 'vitest';

import { allowedUseFor, buildClaimLedger, buildSourceDisplay } from './claimLedger.js';
import type { ResearchDocument } from './research/researchStory.js';
import { isDiscoveryOnlyUrl, tierForUrl } from './research/sourceTiers.js';
import { detectSyndicatedGroups, independenceKeys, shingleContainment } from './research/syndication.js';
import { evidenceCeiling } from './verifyClaims.js';
import { renderBriefForWriter } from './writerBrief.js';

function doc(id: string, text: string, tier: EvidenceTier, publisher: string, kind: EvidenceSourceKind = 'fetched_article'): ResearchDocument {
  return { source: { id, kind, url: `https://example.com/${id}`, title: null, publisher, tier, publishedAt: null, fetchedAt: null }, text };
}

const WIRE =
  'NEW DELHI (Reuters) - The Reserve Bank of India raised its key repo rate by 25 basis points to 5.50% on Wednesday, its first increase since February 2023, citing persistent food inflation and a weaker rupee. Economists polled earlier had been split on the decision. The central bank kept its stance unchanged and said it would remain watchful of price pressures over the coming months.';

describe('syndication detection (spec 28)', () => {
  it('groups copied reports and keeps genuinely independent ones apart', () => {
    const docs = [
      doc('source_1', WIRE, 'secondary', 'Reuters'),
      doc('source_2', `Updated. ${WIRE} More to follow.`, 'secondary', 'Economic Times'),
      doc('source_3', `${WIRE.replace('NEW DELHI (Reuters) - ', '')}`, 'secondary', 'Mint'),
      doc('source_4', 'Borrowers with repo-linked home loans will see EMIs adjust at their next reset, bankers told this newspaper, though the exact timing varies by lender and loan agreement and most banks reset quarterly. Analysts expect deposit rates to follow with a lag of one or two quarters.', 'secondary', 'Business Standard'),
    ];
    expect(shingleContainment(docs[0]?.text ?? '', docs[1]?.text ?? '')).toBeGreaterThan(0.9);
    const groups = detectSyndicatedGroups(docs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sort()).toEqual(['source_1', 'source_2', 'source_3']);
    const keys = independenceKeys(docs);
    expect(new Set(['source_1', 'source_2', 'source_3'].map((id) => keys.get(id))).size).toBe(1);
    expect(keys.get('source_4')).toBe('Business Standard');
  });

  it('never counts three outlets repeating one wire story as independent confirmation', () => {
    const docs = [
      doc('source_1', WIRE, 'secondary', 'Reuters'),
      doc('source_2', `Updated. ${WIRE}`, 'secondary', 'Economic Times'),
      doc('source_3', `${WIRE} Copied.`, 'secondary', 'Mint'),
    ];
    const claim = buildClaimFixture('c1', 'RBI raised the repo rate by 25 basis points to 5.50%.', {
      evidence: docs.map((d) => ({ sourceId: d.source.id, quote: 'raised its key repo rate by 25 basis points to 5.50%', quoteFound: true })),
    });
    const byId = new Map(docs.map((d) => [d.source.id, d]));
    // Without syndication awareness three publishers make it VERIFIED...
    expect(evidenceCeiling(claim, byId)).toBe('VERIFIED');
    // ...but they are one report, so it is only HIGH_CONFIDENCE.
    expect(evidenceCeiling(claim, byId, independenceKeys(docs))).toBe('HIGH_CONFIDENCE');
  });
});

describe('source tiers (spec 4)', () => {
  it('keeps social media, Reddit, Wikipedia and blogs discovery-only', () => {
    for (const url of ['https://en.wikipedia.org/wiki/Asian_Games', 'https://www.reddit.com/r/india', 'https://x.com/someone/status/1', 'https://someone.substack.com/p/a', 'https://medium.com/@a/b']) {
      expect(tierForUrl(url)).toBe('discovery');
      expect(isDiscoveryOnlyUrl(url)).toBe(true);
    }
  });

  it('treats regulators, official statistics and official sports bodies as primary', () => {
    expect(tierForUrl('https://www.rbi.org.in/x')).toBe('primary');
    expect(tierForUrl('https://mospi.gov.in/data')).toBe('primary');
    expect(tierForUrl('https://www.oecd.org/report')).toBe('primary');
    expect(tierForUrl('https://www.ocasia.org/games/results')).toBe('primary');
    expect(tierForUrl('https://www.reuters.com/a')).toBe('secondary');
  });
});

function brief(overrides: Partial<EditorialBrief> = {}): EditorialBrief {
  return EditorialBriefSchema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    schemaVersion: 1,
    createdAt: '2026-10-08T00:00:00.000Z',
    runId: 'run',
    topic: 'RBI repo rate',
    topicKey: 'rbi repo rate',
    kind: 'researched',
    riskLevel: 'medium',
    userRequest: {},
    research: { documentsConsidered: 3, documentsUsed: 3, syndicatedGroups: [['source_2', 'source_3']] },
    sources: [
      { id: 'source_1', kind: 'primary_feed_item', url: 'https://rbi.org.in/pr', title: 'Monetary Policy Statement', publisher: 'Reserve Bank of India', tier: 'primary', publishedAt: '2026-10-07T06:00:00Z', fetchedAt: null },
      { id: 'source_2', kind: 'fetched_article', url: 'https://www.reuters.com/a', title: 'RBI hikes', publisher: 'Reuters', tier: 'secondary', publishedAt: '2026-10-08T00:00:00Z', fetchedAt: null },
      { id: 'source_3', kind: 'fetched_article', url: 'https://economictimes.indiatimes.com/a', title: 'RBI hikes (wire)', publisher: 'Economic Times', tier: 'secondary', publishedAt: null, fetchedAt: null },
      { id: 'source_4', kind: 'news_search_result', url: 'https://reddit.com/r/x', title: 'thread', publisher: 'reddit', tier: 'discovery', publishedAt: null, fetchedAt: null },
    ],
    claims: [
      {
        ...buildClaimFixture('claim_001', 'RBI raised the repo rate by 25 basis points to 5.50%.', {
        verificationStatus: 'VERIFIED',
        sourceIds: ['source_1', 'source_2', 'source_3'],
        evidence: [
          { sourceId: 'source_1', quote: 'raise the policy repo rate by 25 basis points', quoteFound: true },
          { sourceId: 'source_2', quote: 'by 25 basis points', quoteFound: true },
          { sourceId: 'source_3', quote: 'by 25 basis points', quoteFound: true },
        ],
        geography: 'India',
      }),
        temporalContext: { status: 'completed', qualifier: null, claimDate: '2026-10-07', sourceDate: null, validFrom: null, validUntil: null },
      },
      buildClaimFixture('claim_002', 'Economists expect another hike in December.', { verificationStatus: 'HIGH_CONFIDENCE', type: 'FORECAST', attributedTo: 'economists polled by Reuters' }),
      buildClaimFixture('claim_003', 'Banks will raise every EMI next week.', { verificationStatus: 'DISPUTED' }),
      buildClaimFixture('claim_004', 'A Reddit user said rates hit a record.', { verificationStatus: 'UNVERIFIED' }),
    ],
    storyEssence: null,
    selectedAngle: null,
    audience: null,
    emotionalMode: null,
    contentDnaVersion: 1,
    brandBrainVersion: 'test',
    promptVersion: 'test',
    ...overrides,
  });
}

describe('claim ledger (spec 5)', () => {
  it('projects every claim with sources, independence, temporal and numeric fields', () => {
    const [first] = buildClaimLedger(brief());
    expect(first).toMatchObject({
      claimId: 'claim_001',
      sourceTier: 'primary',
      // RBI + one Reuters story syndicated by ET = two independent reports.
      independentSourceCount: 2,
      evidenceDate: '2026-10-07',
      publicationDate: '2026-10-08T00:00:00Z',
      numericalValue: 25,
      unit: 'bps',
      geography: 'India',
      originalSource: 'Reserve Bank of India',
      allowedUse: 'state_as_fact',
      contradictionStatus: 'none',
      lastVerifiedAt: '2026-10-08T00:00:00.000Z',
    });
  });

  it('decides allowed use from verification and attribution', () => {
    const claims = brief().claims;
    expect(claims.map(allowedUseFor)).toEqual(['state_as_fact', 'attribute', 'hedge_as_uncertain', 'do_not_use']);
  });

  it('builds clean source labels from verified evidence only, best tier first', () => {
    const display = buildSourceDisplay(brief());
    expect(display.map((d) => d.label)).toEqual([
      'Reserve Bank of India: Monetary Policy Statement, October 7, 2026',
      'Reuters: RBI hikes, October 8, 2026',
      'Economic Times: RBI hikes (wire)',
    ]);
    expect(display.some((d) => d.url?.includes('reddit'))).toBe(false);
  });

  it('gives the writer the investigation notes, not just the facts', () => {
    const withEssence = brief({
      storyEssence: {
        event: 'RBI hiked',
        whatChanged: 'rates up',
        novelty: null,
        significance: 's',
        mostImportantFactClaimId: 'claim_001',
        mostInterestingFactClaimId: 'claim_001',
        immediateConsequence: null,
        longerTermImplication: null,
        readerImpact: null,
        businessImpact: null,
        economicImpact: null,
        hiddenMechanism: null,
        surpriseElement: null,
        tension: null,
        whyItMatters: 'w',
        recommendedAngleId: null,
        confidence: 0.8,
        commonExplanation: 'Inflation forced it.',
        strongestCounterargument: 'Core inflation is falling.',
        whatDataDoesNotShow: ['whether more hikes follow'],
      } as EditorialBrief['storyEssence'],
    });
    const rendered = renderBriefForWriter(withEssence);
    expect(rendered).toContain('INVESTIGATION NOTES');
    expect(rendered).toContain('Strongest counterargument: Core inflation is falling.');
    expect(rendered).toContain('What the data does NOT show: whether more hikes follow');
  });
});
