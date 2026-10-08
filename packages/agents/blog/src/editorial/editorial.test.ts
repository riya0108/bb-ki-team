import type { ComponentScores, EditorialMemory, EditorialQuality } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import type { ComponentProposal } from './componentDecision.js';
import { decideComponents } from './componentDecision.js';
import { checkComponentEvidence, dropUnsupportedComponents } from './componentEvidence.js';
import { applyDeterministicBounds, evidenceCeilingScore, hardThresholdFailures } from './critic.js';
import { fallbackArchitecture, maxDepthFor, reconcileArchitecture } from './architect.js';
import { assessCoverage, resolveInternalLinks } from './coverage.js';
import { checkAiSlop } from './slopFilter.js';
import { checkStructure } from './structureChecks.js';
import { classifyEnding, classifyOpening, computeStyleMetrics, shapeFromPlainText } from './styleMetrics.js';
import { aggregateStyleProfile, renderStyleProfileForWriter } from './styleProfile.js';
import { brief, claim, MEDAL_CLAIMS, writerDraft } from './testFixtures.js';
import { enforceAllowedComponents } from './writeArticle.js';

const scores = (overrides: Partial<ComponentScores> = {}): ComponentScores => ({
  informationGain: 8,
  readerValue: 8,
  topicFit: 8,
  evidenceSupport: 8,
  engagementValue: 6,
  redundancy: 2,
  editorialNecessity: 7,
  ...overrides,
});

const proposal = (type: ComponentProposal['type'], overrides: Partial<ComponentProposal> = {}): ComponentProposal => ({
  type,
  purpose: `a ${type}`,
  claimIds: ['claim_001'],
  afterSectionIndex: 0,
  scores: scores(),
  ...overrides,
});

const quality = (overrides: Partial<EditorialQuality> = {}): EditorialQuality => ({
  originalityScore: 9,
  informationDensityScore: 9,
  factualGroundingScore: 10,
  narrativeFlowScore: 9,
  humanVoiceScore: 9,
  clarityScore: 9,
  depthScore: 9,
  curiosityScore: 9,
  readerUtilityScore: 9,
  brandFitScore: 9,
  evidenceQualityScore: 10,
  counterArgumentScore: 9,
  interactiveUsefulnessScore: 9,
  seoQualityScore: 8,
  aiSlopRiskScore: 1,
  ...overrides,
});

const medalBrief = brief(MEDAL_CLAIMS);

describe('anti-AI-slop filter', () => {
  it('blocks stock AI phrases, generic openings and generic endings', () => {
    const report = checkAiSlop({
      opening: "In today's fast-paced world, sport is an important topic.",
      body: "Let's dive in. It's important to note that funding plays a crucial role in this multifaceted landscape.",
      ending: 'In conclusion, the future looks promising.',
      headings: ['Introduction', 'Conclusion'],
    });
    const codes = report.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['ai_phrases', 'generic_opening', 'generic_ending', 'generic_headings']));
    expect(report.findings.find((f) => f.code === 'ai_phrases')?.evidence).toEqual(
      expect.arrayContaining(["it's important to note", 'plays a crucial role', 'multifaceted', 'landscape', 'in conclusion']),
    );
    expect(report.riskScore).toBe(10);
  });

  it('detects formulaic rhythm: repeated openers and "not X, but Y"', () => {
    const body = Array.from({ length: 5 }, (_, i) => `But the data says ${i}. It is not about money, but about time.`).join(' ');
    const report = checkAiSlop({ opening: 'China won 383 medals.', body, ending: 'Systems win.', headings: [] });
    expect(report.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['repetitive_openers', 'excessive_but', 'not_x_but_y']));
  });

  it('blocks research-process language leaking into prose', () => {
    const report = checkAiSlop({ opening: 'The verified medal tallies show a gap.', body: 'This rests on claim_002 in the brief.', ending: 'Systems win.', headings: [] });
    expect(report.findings.find((f) => f.code === 'process_language')?.evidence).toEqual(expect.arrayContaining(['verified medal tallies', 'claim_002', 'the brief']));
  });

  it('blocks sentences repeated word for word and a duplicated "Bottom line:" label', () => {
    const repeated = 'India retained fourth place by pipping Uzbekistan on silver medals.';
    const report = checkAiSlop({ opening: repeated, body: `Context first. ${repeated}`, ending: 'Bottom line: systems win.', headings: [] });
    expect(report.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['repeated_sentences', 'generic_ending']));
  });

  it('passes a specific, human opening', () => {
    const report = checkAiSlop({
      opening: 'India now has more people than China. At the Asian Games, China won more than three times as many medals.',
      body: 'Sports schools pick children early.',
      ending: 'Headcount was never the constraint.',
      headings: ['Where the gap comes from'],
    });
    expect(report.findings).toEqual([]);
    expect(report.riskScore).toBe(0);
  });
});

describe('component evidence', () => {
  it('rejects a table cell number that is not in any verified claim', () => {
    const draft = writerDraft({
      table: {
        kind: 'comparison',
        title: 'Medals',
        subtitle: null,
        columns: [{ label: 'Country', align: 'left' }, { label: 'Medals', align: 'right' }],
        rows: [['China', '383'], ['India', '112']],
        sourceNote: 'OCA',
        footnote: null,
        claimIds: ['claim_001', 'claim_002'],
        afterSectionIndex: 0,
      },
    });
    const issues = checkComponentEvidence(draft, medalBrief);
    expect(issues).toEqual([{ component: 'table', problem: 'unsupported_number', detail: '"112" is not in any verified claim' }]);
    const { draft: cleaned, dropped } = dropUnsupportedComponents(draft, issues);
    expect(cleaned.table).toBeNull();
    expect(dropped).toEqual(['table']);
  });

  it('accepts a quiz whose correct answer and explanation are verified, ignoring wrong options', () => {
    const draft = writerDraft({
      quiz: {
        title: 'Quiz',
        questions: [
          {
            question: 'How many medals did China win?',
            type: 'multiple_choice',
            options: ['85', '169', '383', '469'],
            correctOptionIndex: 2,
            explanation: 'China won 383 medals, including 201 golds.',
            difficulty: 'easy',
            sourceNote: null,
            claimIds: ['claim_001'],
          },
        ],
        afterSectionIndex: 0,
      },
    });
    expect(checkComponentEvidence(draft, medalBrief)).toEqual([]);
  });

  it('rejects an unsupported quiz answer, quizzes without claims, and unverified claim citations', () => {
    const draft = writerDraft({
      quiz: {
        title: 'Quiz',
        questions: [
          { question: 'How many will India win next time?', type: 'estimate', options: ['120', '150'], correctOptionIndex: 1, explanation: 'Reports say 150.', difficulty: 'hard', sourceNote: null, claimIds: [] },
        ],
        afterSectionIndex: 0,
      },
      timeline: { title: 'T', events: [{ date: '2014', title: 'a', description: 'a', sourceNote: null }, { date: '2018', title: 'b', description: 'b', sourceNote: null }, { date: '2023', title: 'c', description: 'c', sourceNote: null }], claimIds: ['claim_003'], afterSectionIndex: 0 },
    });
    const problems = checkComponentEvidence(draft, medalBrief).map((i) => `${i.component}:${i.problem}`);
    expect(problems).toEqual(expect.arrayContaining(['quiz:unsupported_number', 'quiz:quiz_without_claims', 'timeline:unusable_claim', 'timeline:unsupported_number']));
  });

  it('lets a decision component use clearly hypothetical numbers', () => {
    const draft = writerDraft({
      decision: {
        title: 'You decide',
        question: 'Where does the money go?',
        options: [
          { label: 'Coaching', revealTitle: 'Slow', revealText: 'Assume ₹500 crore goes to coaching: results take a decade.', evidenceNote: null },
          { label: 'Elite', revealTitle: 'Fast', revealText: 'Faster medals, thinner base.', evidenceNote: null },
        ],
        claimIds: [],
        afterSectionIndex: 0,
      },
    });
    expect(checkComponentEvidence(draft, medalBrief)).toEqual([]);
  });

  it('allows no numbers in components when there is no verified evidence at all', () => {
    const draft = writerDraft({ comparisonStat: { label: 'x', leftValue: '383', leftCaption: 'China', rightValue: '106', rightCaption: 'India', footnote: 'gap', afterSectionIndex: 0 } });
    expect(checkComponentEvidence(draft, brief([], { kind: 'opinion' })).every((i) => i.problem === 'no_evidence_base')).toBe(true);
  });
});

describe('component decision engine', () => {
  it('uses a component only when it earns its place, and never a fact-bearing one without verified claims', () => {
    const decisions = decideComponents({
      proposals: [
        proposal('table'),
        proposal('quiz', { claimIds: ['claim_003'] }),
        proposal('poll', { scores: scores({ editorialNecessity: 3 }) }),
        proposal('timeline', { scores: scores({ redundancy: 8 }) }),
      ],
      brief: medalBrief,
      depth: 'deep_analysis',
    });
    const byType = Object.fromEntries(decisions.map((d) => [d.type, d]));
    expect(byType.table?.decision).toBe('USE');
    expect(byType.quiz?.decision).toBe('DO_NOT_USE');
    expect(byType.quiz?.reason).toContain('no verified claims');
    expect(byType.poll?.reason).toContain('not editorially necessary');
    expect(byType.timeline?.reason).toContain('repeats what the prose already says');
  });

  it('handles duplicate proposals and enforces per-depth and interactive caps', () => {
    const decisions = decideComponents({
      proposals: [
        proposal('quiz'),
        proposal('quiz', { scores: scores({ informationGain: 2 }) }),
        proposal('decision'),
        proposal('poll'),
        proposal('revealCards'),
        proposal('table'),
      ],
      brief: medalBrief,
      depth: 'investigation',
    });
    expect(decisions.filter((d) => d.type === 'quiz')).toHaveLength(1);
    const interactive = decisions.filter((d) => d.decision === 'USE' && ['quiz', 'decision', 'poll', 'revealCards'].includes(d.type));
    expect(interactive).toHaveLength(3);

    const short = decideComponents({ proposals: [proposal('table'), proposal('quiz'), proposal('timeline')], brief: medalBrief, depth: 'short_explainer' });
    expect(short.filter((d) => d.decision === 'USE')).toHaveLength(2);
  });

  it('lets a confirmed "avoid" memory veto a component', () => {
    const memory: EditorialMemory = {
      memoryId: '00000000-0000-4000-8000-0000000000aa',
      category: 'structure',
      subject: 'component:quiz',
      polarity: 'avoid',
      statement: 'Quizzes tend to feel forced; avoid them.',
      confidence: 0.9,
      source: 'explicit_feedback',
      status: 'CONFIRMED',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      lastUsedAt: null,
      timesConfirmed: 1,
      timesRejected: 0,
      validUntil: null,
      supersededById: null,
      evidence: [],
    };
    const [quiz] = decideComponents({ proposals: [proposal('quiz')], brief: medalBrief, depth: 'standard', memories: [memory] });
    expect(quiz?.decision).toBe('DO_NOT_USE');
    expect(quiz?.reason).toContain('Quizzes tend to feel forced');
  });

  it('strips components the plan did not approve from a draft', () => {
    const architecture = fallbackArchitecture('topic', medalBrief);
    const draft = writerDraft({ pullQuote: { text: 'Systems win.', afterSectionIndex: 0 } });
    expect(enforceAllowedComponents(draft, architecture).pullQuote).toBeNull();
    expect(enforceAllowedComponents(draft, null).pullQuote).not.toBeNull();
  });
});

describe('article architecture', () => {
  it('caps depth by the verified material and filters claim IDs to usable claims', () => {
    // Two verified claims carry a short explainer at most — never pad.
    expect(maxDepthFor(medalBrief)).toBe('short_explainer');
    expect(maxDepthFor(brief([], { kind: 'insufficient_evidence' }))).toBe('short_explainer');
    const architecture = reconcileArchitecture(
      {
        thesis: 'Systems, not headcount.',
        primaryAngle: 'Population vs medals',
        secondaryAngle: null,
        readerQuestion: 'Why doesn\'t population turn into medals?',
        hiddenMechanism: 'Talent pipelines',
        counterArgument: 'India is improving fast',
        bullCase: null,
        bearCase: null,
        whatWeDontKnow: [],
        keyFactClaimIds: ['claim_001', 'claim_003', 'claim_999'],
        keyNumberClaimIds: ['claim_002'],
        sectionPlan: [
          { role: 'basic_facts', purpose: 'p', headingIdea: 'h', claimIds: ['claim_001', 'claim_003'] },
          { role: 'counterargument', purpose: 'p', headingIdea: 'h', claimIds: [] },
        ],
        articleDepth: 'investigation',
        mustNotClaim: [],
        componentProposals: [{ type: 'table', purpose: 'compare', claimIds: ['claim_001'], afterSectionIndex: 7, scores: scores() }],
        priorCoverageDecision: 'new_article',
        editorialConfidence: 0.8,
      },
      { brief: medalBrief, memories: [] },
    );
    expect(architecture.articleDepth).toBe('short_explainer');
    expect(architecture.targetWordRange).toEqual([700, 1000]);
    expect(architecture.keyFactClaimIds).toEqual(['claim_001']);
    expect(architecture.sectionPlan[0]?.claimIds).toEqual(['claim_001']);
    expect(architecture.componentDecisions[0]).toMatchObject({ type: 'table', decision: 'USE', afterSectionIndex: 1 });
  });
});

describe('structure checks', () => {
  it('blocks a planned counterargument that the draft never engages', () => {
    const architecture = { ...fallbackArchitecture('t', medalBrief), counterArgument: 'India is catching up', articleDepth: 'standard' as const };
    const draft = writerDraft({
      sections: [
        { heading: 'Facts', body: 'China won 383 medals.', sourceNote: null, claimIds: [] },
        { heading: 'Why', body: 'Pipelines.', sourceNote: null, claimIds: [] },
        { heading: 'Next', body: 'Watch funding.', sourceNote: null, claimIds: [] },
      ],
    });
    expect(checkStructure(draft, architecture).find((w) => w.code === 'missing_counterargument')?.severity).toBe('block');
    expect(checkStructure(writerDraft(), architecture).some((w) => w.code === 'missing_counterargument')).toBe(false);
  });

  it('warns when the conclusion repeats the introduction', () => {
    const draft = writerDraft({ conclusion: 'China won 383 medals in Hangzhou. India won 106, its best ever. That gap is the story.' });
    expect(checkStructure(draft, null).some((w) => w.code === 'conclusion_repeats_intro')).toBe(true);
  });
});

describe('editorial critic bounds', () => {
  it('never lets the model score below the deterministic slop risk or above the fact caps', () => {
    const bounded = applyDeterministicBounds(quality({ aiSlopRiskScore: 0 }), { slopRisk: 4, slopNotes: [], driftIssues: 1, componentEvidenceIssues: 0, structureBlocks: [] }, medalBrief);
    expect(bounded.aiSlopRiskScore).toBe(4);
    expect(bounded.factualGroundingScore).toBe(7);
    expect(hardThresholdFailures(bounded, medalBrief)).toEqual(expect.arrayContaining(['factualGroundingScore 7 < 9', 'aiSlopRiskScore 4 > 2']));
  });

  it('caps evidence quality by the research and exempts opinion pieces from it', () => {
    expect(evidenceCeilingScore(brief([], { kind: 'insufficient_evidence' }))).toBe(3);
    const mixed = brief([claim('a', 'x'), claim('b', 'y', { verificationStatus: 'HIGH_CONFIDENCE' })]);
    expect(evidenceCeilingScore(mixed)).toBe(8.5);
    const opinion = brief([], { kind: 'opinion' });
    expect(hardThresholdFailures(quality({ evidenceQualityScore: 2 }), opinion)).toEqual([]);
    expect(hardThresholdFailures(quality(), medalBrief)).toEqual([]);
  });
});

describe('style metrics and profile', () => {
  it('classifies openings and endings', () => {
    expect(classifyOpening('Why does India win so few medals? Start with the numbers.')).toBe('question');
    expect(classifyOpening('China won 383 medals in Hangzhou.')).toBe('statistic');
    expect(classifyOpening('India has more people. But China wins more medals.')).toBe('tension');
    expect(classifyEnding('So what will India build next?')).toBe('question');
    expect(classifyEnding('Which means the real constraint is coaching.')).toBe('implication');
  });

  it('measures plain reference text and aggregates a weighted profile', () => {
    const text = ['Why the gap?', 'Short para one.', 'A second, longer paragraph with 383 medals and 106 medals in it.', 'Final word: systems win.'].join('\n\n');
    const metrics = computeStyleMetrics(shapeFromPlainText(text));
    expect(metrics.h2Count).toBe(1);
    expect(metrics.numbersPer1000Words).toBeGreaterThan(0);
    const sample = (kind: 'approved_article' | 'approved_reference', wordCount: number) => ({
      id: '00000000-0000-4000-8000-0000000000b1',
      kind,
      label: 'x',
      sourceUrl: null,
      contentId: null,
      metrics: { ...metrics, wordCount },
      traits: { openingTechnique: 'counterintuitive number', transitionPatterns: [], conclusionPattern: null, evidenceUse: null, narrativeUse: null, conversationality: 7, editorialDepth: null, directness: null, skepticism: null, warmth: null, formality: null },
      active: true,
      createdAt: '2026-10-01T00:00:00Z',
    });
    const profile = aggregateStyleProfile([sample('approved_article', 1500), sample('approved_reference', 900)]);
    expect(profile.ownArticleCount).toBe(1);
    expect(profile.metrics?.wordCount).toBe(1300);
    const rendered = renderStyleProfileForWriter(profile);
    expect(rendered).toContain('never copy any sentence');
    expect(rendered).toContain('counterintuitive number');
    expect(renderStyleProfileForWriter(aggregateStyleProfile([]))).toContain('BLOG STYLE BASELINE');
  });
});

describe('coverage and internal links', () => {
  const index = [
    { contentId: '00000000-0000-4000-8000-0000000000c1', status: 'published', topic: 'China Asian Games medals dominance', title: 'How China built a medal machine', slug: 'china-medal-machine', thesis: 'Sports schools', primaryAngle: null, topicKey: 'x', category: 'Sport', publishedUrl: 'https://bullorbear.in/sport/china-medal-machine/', createdAt: '2026-01-01T00:00:00Z' },
    { contentId: '00000000-0000-4000-8000-0000000000c2', status: 'in_review', topic: 'UPI fees', title: 'UPI fees explained', slug: 'upi', thesis: null, primaryAngle: null, topicKey: 'y', category: 'Money', publishedUrl: null, createdAt: '2026-01-01T00:00:00Z' },
  ];

  it('flags prior coverage and offers only published, relevant link targets', () => {
    const ctx = assessCoverage(index, 'Why China dominates Asian Games medals', null);
    expect(ctx.coverage.status).toBe('previously_covered');
    expect(ctx.linkCandidates.map((c) => c.title)).toEqual(['How China built a medal machine']);
  });

  it('keeps a link only when its anchor appears in the text and the target was offered', () => {
    const ctx = assessCoverage(index, 'China Asian Games medals', null);
    const links = resolveInternalLinks(
      [
        { anchorText: 'medal machine', targetContentId: '00000000-0000-4000-8000-0000000000c1', reason: 'background' },
        { anchorText: 'not in text', targetContentId: '00000000-0000-4000-8000-0000000000c1', reason: 'x' },
        { anchorText: 'UPI', targetContentId: '00000000-0000-4000-8000-0000000000c2', reason: 'x' },
      ],
      ctx.linkCandidates,
      'China runs a medal machine.',
    );
    expect(links).toHaveLength(1);
    expect(links[0]?.targetUrl).toBe('https://bullorbear.in/sport/china-medal-machine/');
  });
});
