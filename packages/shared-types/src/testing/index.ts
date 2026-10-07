// Test-only fixtures — never imported by production code. Shared so that qa-gate,
// editorial-intelligence and every platform agent test against the same RBI
// regression scenario (spec 40/65) instead of each hand-rolling a slightly different one.

import type { Claim, TemporalStatus } from '../claim.js';
import type { EditorialBrief } from '../editorialBrief.js';
import { EditorialBriefSchema } from '../editorialBrief.js';

export interface ClaimFixtureOverrides extends Partial<Omit<Claim, 'temporalContext'>> {
  temporal?: TemporalStatus;
  qualifier?: string | null;
}

export function buildClaimFixture(id: string, text: string, overrides: ClaimFixtureOverrides = {}): Claim {
  const { temporal, qualifier, ...rest } = overrides;
  return {
    id,
    text,
    type: 'FACT',
    verificationStatus: 'VERIFIED',
    confidence: 0.95,
    importance: 8,
    origin: 'research',
    sourceIds: ['source_1'],
    evidence: [{ sourceId: 'source_1', quote: text, quoteFound: true }],
    entities: [],
    numbers: [],
    dates: [],
    temporalContext: {
      status: temporal ?? 'completed',
      qualifier: qualifier ?? null,
      claimDate: null,
      sourceDate: null,
      validFrom: null,
      validUntil: null,
    },
    attributedTo: null,
    mustPreserve: false,
    allowedParaphrase: [],
    conflictingClaimIds: [],
    notes: null,
    ...rest,
  };
}

export const RBI_FIRST_SINCE_CLAIM_ID = 'claim_rbi_001';

export function buildRbiClaims(): Claim[] {
  return [
    buildClaimFixture(RBI_FIRST_SINCE_CLAIM_ID, 'This was the first RBI rate hike since 2023.', {
      importance: 10,
      mustPreserve: true,
      entities: ['RBI'],
      dates: ['2023'],
      temporal: 'first_since',
      qualifier: 'first time since 2023',
      sourceIds: ['source_1', 'source_2'],
    }),
    buildClaimFixture('claim_rbi_002', 'RBI raised the repo rate by 25 basis points to 5.50%.', {
      type: 'STATISTIC',
      importance: 8,
      mustPreserve: true,
      entities: ['RBI'],
      numbers: ['25 basis points', '5.50%'],
    }),
    buildClaimFixture(
      'claim_rbi_003',
      'Borrowers with floating-rate home and car loans linked to the repo rate could see higher EMIs.',
      { type: 'EFFECT', importance: 9, temporal: 'possible' },
    ),
  ];
}

export function buildRbiEditorialBrief(overrides: Partial<EditorialBrief> = {}): EditorialBrief {
  const claims = buildRbiClaims();
  return EditorialBriefSchema.parse({
    id: '22222222-2222-4222-8222-222222222222',
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    runId: 'test-run',
    topic: 'RBI just hiked rates for the first time since 2023.',
    topicKey: '2023 first hike rate rbi',
    kind: 'researched',
    riskLevel: 'medium',
    riskFlags: [],
    userRequest: {
      candidateFacts: ['RBI just hiked rates for the first time since 2023.'],
      editorialIntent: ['The hike could affect home and car loan borrowers.'],
      styleRequests: [],
      angleRequests: [],
      hookSuggestions: [],
    },
    research: { queries: ['RBI repo rate hike'], documentsConsidered: 2, documentsUsed: 2, failures: [] },
    sources: [
      {
        id: 'source_1',
        kind: 'primary_feed_item',
        url: 'https://www.rbi.org.in/pressrelease',
        title: 'Monetary Policy Statement',
        publisher: 'Reserve Bank of India',
        tier: 'primary',
        publishedAt: null,
        fetchedAt: null,
      },
      {
        id: 'source_2',
        kind: 'fetched_article',
        url: 'https://www.reuters.com/rbi-hike',
        title: 'RBI hikes for first time since 2023',
        publisher: 'Reuters',
        tier: 'secondary',
        publishedAt: null,
        fetchedAt: null,
      },
    ],
    claims,
    storyEssence: {
      event: 'RBI raised the repo rate by 25 basis points.',
      whatChanged: 'Borrowing costs went up after a long pause.',
      novelty: 'First RBI rate hike since 2023.',
      significance: 'It ends a long stretch without a hike.',
      mostImportantFactClaimId: RBI_FIRST_SINCE_CLAIM_ID,
      mostInterestingFactClaimId: RBI_FIRST_SINCE_CLAIM_ID,
      affectedAudience: ['floating-rate home loan borrowers', 'car loan borrowers'],
      immediateConsequence: 'Floating-rate EMIs could rise.',
      longerTermImplication: null,
      readerImpact: 'Your EMI could go up.',
      businessImpact: null,
      economicImpact: null,
      hiddenMechanism: 'Repo-linked loans reprice when the repo rate moves.',
      surpriseElement: null,
      tension: null,
      whyItMatters: 'Borrowers may be among the first to feel it.',
      rankedFacts: [
        { claimId: RBI_FIRST_SINCE_CLAIM_ID, importance: 10, reason: 'novelty' },
        { claimId: 'claim_rbi_003', importance: 9, reason: 'reader consequence' },
        { claimId: 'claim_rbi_002', importance: 8, reason: 'size of move' },
      ],
      editorialAngles: [],
      recommendedAngleId: null,
      confidence: 0.9,
    },
    selectedAngle: {
      id: 'angle_1',
      angle: 'The first hike since 2023 lands on borrowers',
      rationale: 'Novelty plus personal consequence.',
      supportingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID, 'claim_rbi_003'],
      audience: 'Indian borrowers',
      emotionalMode: 'personalConsequence',
      riskLevel: 'medium',
      relevance: 9,
      novelty: 9,
      readerImpact: 9,
      curiosity: 7,
      brandFit: 9,
      matchesUserIntent: true,
    },
    hookCandidates: [],
    selectedHooks: [
      {
        id: 'hook_1',
        text: "RBI just hiked rates for the first time since 2023, and if you have a home or car loan, here's why your EMI could be affected.",
        pattern: 'firstOrLast',
        supportingClaimIds: [RBI_FIRST_SINCE_CLAIM_ID, 'claim_rbi_003'],
      },
    ],
    audience: 'Indian borrowers',
    emotionalMode: 'personalConsequence',
    keyFactClaimIds: [RBI_FIRST_SINCE_CLAIM_ID, 'claim_rbi_003', 'claim_rbi_002'],
    protectedClaimIds: [RBI_FIRST_SINCE_CLAIM_ID, 'claim_rbi_002'],
    thingsNotToSay: ['hiked rates again', 'another rate hike', 'resumed its rate-hiking cycle'],
    uncertaintyNotes: [],
    temporalNotes: ['"first time since 2023" is a first occurrence, never a repeat.'],
    contentDnaVersion: 1,
    brandBrainVersion: 'test',
    promptVersion: 'test',
    ...overrides,
  });
}
