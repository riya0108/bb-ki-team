// Test-only RBI regression scenario (spec 40/65) — never imported by production code.
// A fake research layer (feeds + articles served through a fake FetchTool) and a
// scripted fake LLM for every editorial-intelligence role, keyed off each prompt's
// "ROLE:" marker. Agent integration tests compose rbiEditorialResponse with their own
// writer responses so topic -> research -> brief -> platform draft runs end to end
// without any network or real model.

import type { LlmCompletionInput } from '@bb/core';
import type { FetchTool } from '@bb/mcp-client';
import { FetchToolError } from '@bb/mcp-client';
import type { FetchResult } from '@bb/shared-types';

export const RBI_USER_MESSAGE = `Draft an X post on the below topic:

RBI just hiked rates for the first time since 2023.

Reframed hook:
RBI just hiked rates for the first time in nearly four years, and if you have a home or car loan, your EMI may be affected.`;

export const RBI_TOPIC = 'RBI just hiked rates for the first time since 2023';

const RBI_PRESS_RELEASE_URL = 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=60001';
const REUTERS_URL = 'https://www.reuters.com/markets/asia/rbi-raises-repo-rate-first-hike-since-2023';

const RBI_PRESS_TEXT =
  'Monetary Policy Statement. The Monetary Policy Committee (MPC) voted to raise the policy repo rate by 25 basis points to 5.50 per cent with immediate effect. This is the first increase in the repo rate since February 2023. The MPC noted that inflation risks have risen.';

const REUTERS_TEXT = `${'The Reserve Bank of India raised its key lending rate on Wednesday. '.repeat(2)}The central bank lifted the repo rate by 25 basis points to 5.50%, its first rate hike since February 2023. Floating-rate home and car loan borrowers linked to the repo rate could see higher EMIs, bankers said. Economists were divided on whether more hikes would follow. ${'Analysts said the decision was closely watched by markets. '.repeat(3)}`;

function rss(items: { title: string; link: string; description: string; source?: string }[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description}</description><pubDate>Wed, 07 Oct 2026 06:00:00 GMT</pubDate>${i.source ? `<source url="https://www.reuters.com">${i.source}</source>` : ''}</item>`,
    )
    .join('')}</channel></rss>`;
}

const ROUTES: { match: RegExp; body: string; contentType: string; title: string | null }[] = [
  {
    match: /rbi\.org\.in\/pressreleases_rss\.xml/,
    contentType: 'text/xml',
    title: null,
    body: rss([
      { title: 'RBI raises policy repo rate by 25 basis points', link: RBI_PRESS_RELEASE_URL, description: RBI_PRESS_TEXT },
      { title: 'RBI releases data on sectoral deployment of bank credit', link: 'https://www.rbi.org.in/other', description: 'Sectoral credit data.' },
    ]),
  },
  { match: /BS_PressReleaseDisplay/, contentType: 'text/html', title: 'Monetary Policy Statement', body: `${RBI_PRESS_TEXT} ${'Further details of the resolution follow. '.repeat(6)}` },
  {
    match: /news\.google\.com\/rss/,
    contentType: 'application/xml',
    title: null,
    body: rss([
      {
        title: 'RBI hikes repo rate for first time since 2023 - Reuters',
        link: 'https://news.google.com/rss/articles/abc',
        description: 'RBI hikes repo rate by 25 basis points to 5.50%, first hike since February 2023.',
        source: 'Reuters',
      },
    ]),
  },
  {
    match: /bing\.com\/news\/search/,
    contentType: 'application/xml',
    title: null,
    body: rss([
      {
        title: 'RBI raises repo rate, first hike since 2023',
        link: `http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=${encodeURIComponent(REUTERS_URL)}&amp;mkt=en-in`,
        description: 'Floating-rate borrowers could see higher EMIs after the RBI repo rate hike.',
      },
    ]),
  },
  { match: /reuters\.com\/markets/, contentType: 'text/html', title: 'RBI raises repo rate in first hike since 2023', body: REUTERS_TEXT },
];

export interface RecordingFetchTool extends FetchTool {
  calls: string[];
}

export function createRbiFetchTool(): RecordingFetchTool {
  const calls: string[] = [];
  return {
    calls,
    fetchUrl(url: string): Promise<FetchResult> {
      calls.push(url);
      const route = ROUTES.find((r) => r.match.test(url));
      if (!route) return Promise.reject(new FetchToolError(url, 'HTTP 404'));
      return Promise.resolve({
        sourceUrl: url,
        contentType: route.contentType,
        title: route.title,
        text: route.body,
        truncated: false,
        fetchedAt: new Date().toISOString(),
      });
    },
    close: () => Promise.resolve(),
  };
}

// A fetch tool for which every URL is unreachable — the "research failed" path.
export function createUnreachableFetchTool(): RecordingFetchTool {
  const calls: string[] = [];
  return {
    calls,
    fetchUrl(url: string): Promise<FetchResult> {
      calls.push(url);
      return Promise.reject(new FetchToolError(url, 'network_error'));
    },
    close: () => Promise.resolve(),
  };
}

// Finds which source_N block in the extractor/verifier prompt contains `quote` — so the
// scripted extractor cites real document IDs regardless of research ordering.
function sourceIdContaining(prompt: string, quote: string): string {
  const blocks = prompt.split(/\n(?=--- source_\d+)/);
  for (const block of blocks) {
    const id = /^--- (source_\d+)/.exec(block)?.[1];
    if (id && block.includes(quote)) return id;
  }
  throw new Error(`fake extractor: no document contains "${quote}"`);
}

export const RBI_BAD_HOOK = 'RBI just nudged rates up again, and borrowers will feel it.';
export const RBI_GOOD_HOOK =
  "RBI just hiked rates for the first time since 2023, and if you have a home or car loan, here's why your EMI could be affected.";

export function rbiEditorialResponse(input: LlmCompletionInput): string | null {
  const system = input.system ?? '';
  const user = input.messages.map((m) => m.content).join('\n');

  if (system.includes('ROLE: editorial-topic-analyst')) {
    return JSON.stringify({
      topicKind: 'news',
      needsResearch: true,
      riskLevel: 'medium',
      normalizedTopic: 'RBI repo rate hike first since 2023',
      searchQueries: ['RBI repo rate hike'],
      entities: ['RBI'],
      userRequest: {
        candidateFacts: ['RBI just hiked rates for the first time since 2023.'],
        editorialIntent: ['Focus on what the hike means for home and car loan borrowers.'],
        styleRequests: [],
        angleRequests: [],
        hookSuggestions: [
          'RBI just hiked rates for the first time in nearly four years, and if you have a home or car loan, your EMI may be affected.',
        ],
      },
    });
  }
  if (system.includes('ROLE: editorial-claim-extractor')) {
    const rbiDoc = sourceIdContaining(user, 'This is the first increase in the repo rate since February 2023.');
    const reutersDoc = sourceIdContaining(user, 'Floating-rate home and car loan borrowers linked to the repo rate could see higher EMIs');
    return JSON.stringify({
      claims: [
        {
          text: 'This was the first RBI rate hike since 2023.',
          type: 'FACT',
          origin: 'user',
          sourceIds: [rbiDoc],
          evidenceQuotes: [{ sourceId: rbiDoc, quote: 'This is the first increase in the repo rate since February 2023.' }],
          entities: ['RBI'],
          dates: ['2023'],
          temporalStatus: 'first_since',
          temporalQualifier: 'first time since 2023',
          importance: 9,
          mustPreserve: true,
        },
        {
          text: 'RBI raised the repo rate by 25 basis points to 5.50%.',
          type: 'STATISTIC',
          origin: 'research',
          sourceIds: [rbiDoc],
          evidenceQuotes: [{ sourceId: rbiDoc, quote: 'raise the policy repo rate by 25 basis points to 5.50 per cent' }],
          entities: ['RBI'],
          numbers: ['25 basis points', '5.50%'],
          temporalStatus: 'completed',
          importance: 8,
          mustPreserve: true,
        },
        {
          text: 'Borrowers with floating-rate home and car loans linked to the repo rate could see higher EMIs.',
          type: 'EFFECT',
          origin: 'research',
          sourceIds: [reutersDoc],
          evidenceQuotes: [{ sourceId: reutersDoc, quote: 'Floating-rate home and car loan borrowers linked to the repo rate could see higher EMIs' }],
          temporalStatus: 'possible',
          importance: 8,
        },
      ],
    });
  }
  if (system.includes('ROLE: editorial-claim-verifier')) {
    const ids = [...new Set(user.match(/claim_\d{3}/g) ?? [])];
    return JSON.stringify({ verdicts: ids.map((claimId) => ({ claimId, supported: 'yes', temporalContextCorrect: true })) });
  }
  if (system.includes('ROLE: editorial-significance-analyst')) {
    return JSON.stringify({
      essence: {
        event: 'RBI raised the repo rate by 25 basis points to 5.50%.',
        whatChanged: 'Borrowing costs went up after a pause that lasted since 2023.',
        novelty: 'The first RBI rate hike since 2023.',
        significance: 'It ends a long stretch without a hike.',
        mostImportantFactClaimId: 'claim_001',
        mostInterestingFactClaimId: 'claim_001',
        affectedAudience: ['floating-rate home loan borrowers', 'car loan borrowers'],
        immediateConsequence: 'Repo-linked EMIs could rise.',
        longerTermImplication: null,
        readerImpact: 'If your loan is linked to the repo rate, your EMI could go up.',
        businessImpact: null,
        economicImpact: null,
        hiddenMechanism: 'Repo-linked loans reprice when the repo rate moves.',
        surpriseElement: 'It is the first hike since 2023.',
        tension: null,
        whyItMatters: 'Borrowers may be among the first to feel it.',
        confidence: 0.9,
      },
      rankedFacts: [
        { claimId: 'claim_001', importance: 10, reason: 'novelty' },
        { claimId: 'claim_003', importance: 9, reason: 'reader consequence' },
        { claimId: 'claim_002', importance: 8, reason: 'size of the move' },
      ],
      angles: [
        {
          angle: 'The first hike since 2023 lands on borrowers',
          rationale: 'Novelty plus a direct personal consequence.',
          supportingClaimIds: ['claim_001', 'claim_003'],
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
        {
          angle: 'Repo mechanics explained',
          rationale: 'How the repo rate feeds through.',
          supportingClaimIds: ['claim_002'],
          audience: 'curious readers',
          emotionalMode: 'curiosity',
          riskLevel: 'low',
          relevance: 6,
          novelty: 4,
          readerImpact: 5,
          curiosity: 6,
          brandFit: 7,
        },
      ],
      recommendedAngleIndex: 0,
      thingsNotToSay: ['rate-hiking cycle resumed'],
      uncertaintyNotes: ['Whether more hikes follow is not established.'],
      temporalNotes: ['"First since 2023" is a first occurrence, never a repeat.'],
    });
  }
  if (system.includes('ROLE: editorial-hook-writer')) {
    return JSON.stringify({
      hooks: [
        { text: RBI_BAD_HOOK, pattern: 'consequenceFirst', supportingClaimIds: ['claim_001'] },
        { text: RBI_GOOD_HOOK, pattern: 'firstOrLast', supportingClaimIds: ['claim_001', 'claim_003'] },
        { text: 'RBI raised the repo rate by 25 basis points to 5.50%.', pattern: 'scale', supportingClaimIds: ['claim_002'] },
        { text: 'Your EMI could rise by ₹4,000 a month.', pattern: 'personalConsequence', supportingClaimIds: ['claim_003'] },
      ],
    });
  }
  if (system.includes('ROLE: editorial-hook-critic')) {
    const ids = [...new Set(user.match(/hook_\d+/g) ?? [])];
    // Deliberately rates the meaning-drifting hook highest and passes every gate: the
    // deterministic critic must still reject it.
    return JSON.stringify({
      critiques: ids.map((hookId) => {
        const top = hookId === 'hook_1' ? 10 : 7;
        return {
          hookId,
          factualAccuracy: true,
          meaningPreservation: true,
          specificity: top,
          curiosity: top,
          relevance: top,
          readerImpact: top,
          surprise: top,
          clarity: top,
          naturalness: top,
          brandFit: top,
          platformPotential: top,
          notes: 'ok',
        };
      }),
    });
  }
  if (system.includes('ROLE: editorial-fact-qa')) {
    return JSON.stringify({
      materialClaims: [{ text: 'RBI just hiked rates for the first time since 2023', kind: 'fact', mappedClaimIds: ['claim_001'] }],
      issues: [],
      missingProtectedClaimIds: [],
      openingClaimIds: ['claim_001'],
      crossPlatformIssues: [],
    });
  }
  return null;
}
