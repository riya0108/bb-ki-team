try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import type { LlmCompletionInput, Logger } from '@bb/core';
import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, getQaResultForVersion, insertContentDna, listLiveEditorialMemories } from '@bb/db';
import type { Pool } from '@bb/db';
import { createRbiFetchTool, RBI_TOPIC, RBI_USER_MESSAGE, rbiEditorialResponse } from '@bb/editorial-intelligence/testing';
import { addRevision, getContentItem, recordApproval } from '@bb/workflows';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runBlogArticle } from './headAgent.js';
import { MEMORY_SCOPE } from './memory/editorialMemory.js';
import { learnFromApprovedBlog } from './memory/learnFromApproval.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;
const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

const dnaBody = {
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: [], secondary: [], avoid: [] },
  opinions: { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
};

const componentScores = { informationGain: 8, readerValue: 8, topicFit: 9, evidenceSupport: 9, engagementValue: 6, redundancy: 2, editorialNecessity: 7 };

const ARCHITECTURE = {
  thesis: 'The first hike since 2023 lands first on repo-linked borrowers.',
  primaryAngle: 'What the first hike since 2023 means for your EMI',
  secondaryAngle: null,
  readerQuestion: 'Will my EMI go up, and when?',
  hiddenMechanism: 'Repo-linked loans reprice when the repo rate moves.',
  counterArgument: 'Whether more hikes follow is not established.',
  bullCase: null,
  bearCase: null,
  whatWeDontKnow: ['Whether more hikes follow'],
  keyFactClaimIds: ['claim_001', 'claim_002'],
  keyNumberClaimIds: ['claim_002'],
  sectionPlan: [
    { role: 'basic_facts', purpose: 'What RBI did', headingIdea: 'What happened', claimIds: ['claim_001', 'claim_002'] },
    { role: 'mechanism', purpose: 'How it reaches EMIs', headingIdea: 'How it reaches your EMI', claimIds: ['claim_003'] },
    { role: 'counterargument', purpose: 'What we do not know', headingIdea: 'What we do not know', claimIds: [] },
  ],
  articleDepth: 'investigation',
  mustNotClaim: ['That more hikes are coming'],
  componentProposals: [
    { type: 'table', purpose: 'The move in numbers', claimIds: ['claim_002'], afterSectionIndex: 0, scores: componentScores },
    { type: 'quiz', purpose: 'Reinforce the size of the move', claimIds: ['claim_002'], afterSectionIndex: 1, scores: componentScores },
    { type: 'poll', purpose: 'Engagement', claimIds: [], afterSectionIndex: 1, scores: { ...componentScores, editorialNecessity: 2 } },
  ],
  priorCoverageDecision: 'new_article',
  editorialConfidence: 0.8,
};

function article(opening: string): string {
  return JSON.stringify({
    titleOptions: ['RBI Just Hiked Rates For The First Time Since 2023'],
    category: 'Money',
    metaDescription: 'What the first RBI rate hike since 2023 means for borrowers.',
    deck: 'The repo rate went up 25 basis points. Here is what changes for your EMI.',
    shortVersion: ['RBI raised the repo rate by 25 basis points to 5.50%.', 'It is the first RBI rate hike since 2023.'],
    thesis: 'The first hike since 2023 lands on repo-linked borrowers.',
    sections: [
      { heading: 'What happened', body: `${opening}\n\nRBI raised the repo rate by 25 basis points to 5.50%.`, sourceNote: 'Source: Reserve Bank of India', claimIds: ['claim_001', 'claim_002'] },
      { heading: 'How it reaches your EMI', body: 'Borrowers with floating-rate home and car loans linked to the repo rate could see higher EMIs.', sourceNote: 'Source: Reuters', claimIds: ['claim_003'] },
      { heading: 'What we do not know', body: 'That said, whether more hikes follow is not established yet.', sourceNote: null, claimIds: [] },
    ],
    practicalTakeaway: 'Check whether your loan is linked to the repo rate.',
    conclusion: 'For repo-linked borrowers, the pause is over.',
    disclaimer: null,
    sources: ['A made-up source the writer invented'],
    articleSummary: 'Explainer on the first RBI rate hike since 2023.',
    estimatedReadTime: '3 min',
    seoStatus: 'ok',
    styleMatchStatus: 'ok',
    table: {
      kind: 'before_after',
      title: 'The move in numbers',
      subtitle: null,
      columns: [{ label: 'Metric', align: 'left' }, { label: 'Value', align: 'right' }],
      rows: [['Change', '25 basis points'], ['New repo rate', '5.50%']],
      sourceNote: 'Source: Reserve Bank of India',
      footnote: null,
      claimIds: ['claim_002'],
      afterSectionIndex: 0,
    },
    quiz: {
      title: 'Quick check',
      questions: [
        {
          question: 'By how much did RBI raise the repo rate?',
          type: 'multiple_choice',
          options: ['10 basis points', '25 basis points', '50 basis points'],
          correctOptionIndex: 1,
          explanation: 'RBI raised the repo rate by 25 basis points to 5.50%.',
          difficulty: 'easy',
          sourceNote: 'Reserve Bank of India',
          claimIds: ['claim_002'],
        },
      ],
      afterSectionIndex: 1,
    },
    // Not approved by the decision engine: must be stripped.
    timeline: { title: 'T', events: [{ date: '2023', title: 'a', description: 'a', sourceNote: null }, { date: '2024', title: 'b', description: 'b', sourceNote: null }, { date: '2026', title: 'c', description: 'c', sourceNote: null }], claimIds: [], afterSectionIndex: 0 },
    seo: { primaryKeyword: 'RBI repo rate hike', secondaryKeywords: ['EMI'], searchIntent: 'news', relatedTopics: [] },
    supportingClaimIds: ['claim_001'],
  });
}

function critic(score: number): string {
  const s = (n: number) => n;
  return JSON.stringify({
    scores: {
      originalityScore: s(score),
      informationDensityScore: s(score),
      factualGroundingScore: 10,
      narrativeFlowScore: s(score),
      humanVoiceScore: s(score),
      clarityScore: 9,
      depthScore: Math.max(score, 8),
      curiosityScore: s(score),
      readerUtilityScore: 9,
      brandFitScore: Math.max(score, 9),
      evidenceQualityScore: 10,
      counterArgumentScore: 9,
      interactiveUsefulnessScore: 9,
      seoQualityScore: 8,
      aiSlopRiskScore: score >= 9 ? 1 : 6,
    },
    humanEditorTest: {
      wouldPublishNextToStrongSubstack: score >= 9,
      couldCut20PercentWithoutLoss: false,
      hasRealThesis: true,
      hasPointOfView: true,
      teachesSomething: true,
      explainsMechanism: true,
      conclusionChangesUnderstanding: true,
      transitionsNatural: true,
    },
    revisionNotes: score >= 9 ? [] : ['Rewrite the opening around the first-since-2023 fact.'],
  });
}

interface Script {
  llm: ReturnType<typeof createFakeLlmClient>;
  writerCalls: LlmCompletionInput[];
  criticCalls: number;
}

function scripted(options: { criticScores: number[] }): Script {
  const script: Script = { llm: createFakeLlmClient(() => ''), writerCalls: [], criticCalls: 0 };
  script.llm = createFakeLlmClient((input) => {
    const editorial = rbiEditorialResponse(input);
    if (editorial !== null) return editorial;
    const system = input.system ?? '';
    if (system.includes('ROLE: blog-article-architect')) return JSON.stringify(ARCHITECTURE);
    if (system.includes('ROLE: blog-editorial-critic')) {
      const score = options.criticScores[Math.min(script.criticCalls, options.criticScores.length - 1)] ?? 9;
      script.criticCalls += 1;
      return critic(score);
    }
    if (system.includes('Blog HTML Agent')) {
      script.writerCalls.push(input);
      return script.writerCalls.length === 1
        ? article("In today's fast-paced world, RBI just hiked rates for the first time since 2023.")
        : article('RBI just hiked rates for the first time since 2023, and repo-linked borrowers feel it first.');
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
  return script;
}

describeIfDb('Blog editorial pipeline (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let contentIds: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, { version: (Date.now() % 1_000_000) + 7, status: 'active', body: dnaBody });
    dnaVersion = dna.version;
  });

  afterEach(async () => {
    if (contentIds.length > 0) {
      await pool.query('DELETE FROM blog_style_samples WHERE content_id = ANY($1::uuid[])', [contentIds]);
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [contentIds]);
    }
    await pool.query('DELETE FROM editorial_memories');
    contentIds = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  async function run(script: Script) {
    const pkg = await runBlogArticle({
      pool,
      llm: script.llm,
      fetchTool: createRbiFetchTool(),
      logger: noopLogger,
      topic: `${RBI_TOPIC} blog-editorial-${Date.now()}`,
      userMessage: RBI_USER_MESSAGE.replace('an X post', 'a blog article'),
      articleType: 'News/context',
      runId: 'r',
    });
    contentIds.push(pkg.contentId);
    return pkg;
  }

  it('plans, drafts, critiques, revises once and returns a verified, component-rich article', async () => {
    const script = scripted({ criticScores: [5, 9] });
    const pkg = await run(script);

    // Architecture: depth capped by the 3 verified claims; the forced poll was rejected.
    expect(pkg.editorialArchitecture?.articleDepth).toBe('standard');
    const decisions = Object.fromEntries((pkg.editorialArchitecture?.componentDecisions ?? []).map((d) => [d.type, d.decision]));
    expect(decisions).toEqual({ table: 'USE', quiz: 'USE', poll: 'DO_NOT_USE' });

    // The first draft opened with stock AI phrasing -> one final-editor revision.
    expect(script.writerCalls).toHaveLength(2);
    const revisionPrompt = script.writerCalls[1]?.messages[0]?.content ?? '';
    expect(revisionPrompt).toContain('FINAL EDITOR');
    expect(revisionPrompt).toContain('Generic AI phrasing');
    expect(script.writerCalls[0]?.messages[0]?.content).toContain('ARTICLE ARCHITECTURE');
    expect(script.criticCalls).toBe(2);

    // Output: approved components only, the unapproved timeline stripped, clean sources.
    expect(pkg.interactiveComponents).toEqual(['table', 'quiz']);
    expect(pkg.htmlFile).toContain('class="data-table"');
    expect(pkg.htmlFile).toContain('class="quiz"');
    expect(pkg.htmlFile).not.toContain('<div class="timeline-wrap">');
    expect(pkg.htmlFile).not.toContain('fast-paced');
    expect(pkg.htmlFile).toContain('The short version');
    expect(pkg.sources.some((s) => s.startsWith('Reserve Bank of India'))).toBe(true);
    expect(pkg.sources).not.toContain('A made-up source the writer invented');
    expect(pkg.editorialQuality?.humanVoiceScore).toBe(9);
    expect(pkg.claimLedger.map((c) => c.claimId)).toEqual(['claim_001', 'claim_002', 'claim_003']);
    expect(pkg.claimLedger[0]?.allowedUse).toBe('state_as_fact');
    expect(pkg.status).toBe('in_review');

    const qa = await getQaResultForVersion(pool, pkg.contentId, 1);
    expect(qa?.result.platformChecks?.editorial_critic?.status).toBe('PASS');
    expect(qa?.result.platformChecks?.ai_slop?.status).toBe('PASS');
    expect(qa?.result.platformChecks?.interactive_components?.status).toBe('PASS');
    expect(qa?.result.editorial?.numberAccuracy.status).toBe('PASS');
    expect(qa?.result.overallStatus).not.toBe('BLOCKED');
  });

  it('blocks — never returns as publish-ready — an article still below the editorial bar after the final editor', async () => {
    const script = scripted({ criticScores: [5, 5] });
    const pkg = await run(script);
    expect(script.writerCalls).toHaveLength(2);
    expect(pkg.editorialWarnings.some((w) => w.code === 'critic_threshold' && w.severity === 'block')).toBe(true);
    const qa = await getQaResultForVersion(pool, pkg.contentId, 1);
    expect(qa?.result.platformChecks?.editorial_critic?.status).toBe('FAIL');
    expect(qa?.result.overallStatus).toBe('BLOCKED');
    expect(qa?.result.publishAllowed).toBe(false);
    // Human approval is still the gate: the item waits in review, nothing is published.
    expect(pkg.status).toBe('in_review');
    expect(pkg.publishAction).toBe('none');
  });

  it('learns the editorial pattern of a human edit on approval, plus a style sample', async () => {
    const pkg = await run(scripted({ criticScores: [9] }));
    const item = await getContentItem(pool, pkg.contentId);
    if (!item) throw new Error('item missing');
    // The editor deletes the quiz by hand in the dashboard, then approves.
    const withoutQuiz = item.currentText.replace(/ {4}<div class="quiz">[\s\S]*?\n {4}<\/div>\n(?= {4}<section)/, '');
    expect(withoutQuiz).not.toContain('class="quiz"');
    const { item: edited } = await addRevision(pool, item.id, { changeType: 'user_edit', newText: withoutQuiz, changedBy: 'user', changedById: 'editor' });
    const approved = await recordApproval(pool, edited.id, edited.currentVersion, 'editor');

    const learned = await learnFromApprovedBlog(pool, approved);
    expect(learned.signals.map((s) => `${s.subject}:${s.polarity}`)).toContain('component:quiz:avoid');
    const memories = await listLiveEditorialMemories(pool, MEMORY_SCOPE);
    const quizMemory = memories.find((m) => m.subject === 'component:quiz');
    expect(quizMemory?.status).toBe('INFERRED');
    expect(quizMemory?.statement).not.toContain('By how much');
    const sample = await pool.query<{ kind: string; metrics: { h2Count: number } }>('SELECT kind, metrics FROM blog_style_samples WHERE content_id = $1', [item.id]);
    expect(sample.rows[0]?.kind).toBe('approved_article');
    expect(sample.rows[0]?.metrics.h2Count).toBe(3);
  });
});
