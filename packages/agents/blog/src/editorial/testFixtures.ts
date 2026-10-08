// Test-only fixtures for the blog editorial modules — never imported by production code.
import type { Claim, EditorialBrief } from '@bb/shared-types';
import { EditorialBriefSchema } from '@bb/shared-types';

import type { DraftBlogArticleWriterOutput } from '../draftArticle.js';
import { DraftBlogArticleWriterSchema } from '../draftArticle.js';

export function claim(id: string, text: string, overrides: Partial<Claim> = {}): Claim {
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
    temporalContext: { status: 'completed', qualifier: null, claimDate: null, sourceDate: null, validFrom: null, validUntil: null },
    attributedTo: null,
    mustPreserve: false,
    allowedParaphrase: [],
    conflictingClaimIds: [],
    notes: null,
    ...overrides,
  };
}

export function brief(claims: Claim[], overrides: Partial<EditorialBrief> = {}): EditorialBrief {
  return EditorialBriefSchema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    schemaVersion: 1,
    createdAt: '2026-10-08T00:00:00.000Z',
    runId: 'run',
    topic: 'India vs China at the Asian Games',
    topicKey: 'asian games china india',
    kind: 'researched',
    riskLevel: 'low',
    riskFlags: [],
    userRequest: {},
    research: { documentsConsidered: 4, documentsUsed: 3, profile: 'deep' },
    sources: [
      { id: 'source_1', kind: 'fetched_article', url: 'https://ocasia.org/results', title: 'Medal table', publisher: 'Olympic Council of Asia', tier: 'primary', publishedAt: '2023-10-08T00:00:00Z', fetchedAt: null },
      { id: 'source_2', kind: 'fetched_article', url: 'https://www.reuters.com/a', title: 'China tops table', publisher: 'Reuters', tier: 'secondary', publishedAt: '2023-10-08T00:00:00Z', fetchedAt: null },
    ],
    claims,
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

export const MEDAL_CLAIMS: Claim[] = [
  claim('claim_001', 'China won 383 medals at the Hangzhou Asian Games, including 201 golds.', { numbers: ['383', '201'] }),
  claim('claim_002', 'India won 106 medals at the Hangzhou Asian Games, its best-ever haul.', { numbers: ['106'] }),
  claim('claim_003', 'Some reports said India could reach 150 medals next time.', { verificationStatus: 'UNVERIFIED', evidence: [] }),
];

export function writerDraft(overrides: Partial<DraftBlogArticleWriterOutput> = {}): DraftBlogArticleWriterOutput {
  return DraftBlogArticleWriterSchema.parse({
    titleOptions: ['Why China Still Dominates the Asian Games'],
    category: 'Sport',
    metaDescription: 'Population is not sporting depth.',
    deck: 'India overtook China in population. Medals tell another story.',
    thesis: 'Medals follow systems, not headcounts.',
    sections: [
      { heading: 'The basic facts', body: 'China won 383 medals in Hangzhou. India won 106, its best ever.\n\nThat gap is the story.', sourceNote: 'Source: OCA', claimIds: ['claim_001', 'claim_002'] },
      { heading: 'The mechanism', body: 'Talent pipelines start young.', sourceNote: null, claimIds: [] },
      { heading: 'The case against', body: 'That said, India improved faster than anyone expected.', sourceNote: null, claimIds: ['claim_002'] },
    ],
    practicalTakeaway: null,
    conclusion: 'So the real question is what India builds next, not how many people it has.',
    disclaimer: null,
    sources: [],
    articleSummary: 'Why population does not equal medals.',
    estimatedReadTime: '5 min',
    seoStatus: 'ok',
    styleMatchStatus: 'ok',
    ...overrides,
  });
}
