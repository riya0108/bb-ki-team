import type { EditorialMemory } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { analyzeArticleHtml } from '../editorial/styleMetrics.js';
import { buildArticleHtml } from '../htmlBuilder.js';

import { activeMemories, renderMemoriesForWriter } from './editorialMemory.js';
import { parseFeedbackDeterministically } from './feedback.js';
import { acceptanceSignals, diffEditorialSignals } from './learnFromApproval.js';
import { copiesSource, sanitizeTraits } from './referenceIngestion.js';

const article = (overrides: Partial<Parameters<typeof buildArticleHtml>[0]> = {}) =>
  buildArticleHtml({
    title: 'Why China Still Dominates',
    deck: 'Deck.',
    category: 'Sport',
    metaDescription: 'Meta.',
    sections: [
      { heading: 'What happened', body: 'China won 383 medals in Hangzhou, and India won 106 of them back home in a record year for Indian sport overall.', sourceNote: null },
      { heading: 'Why', body: 'Pipelines matter more than population when it comes to medals at this level of competition.', sourceNote: null },
      { heading: 'Context', body: 'History helps explain a lot of the remaining gap between the two countries over decades.', sourceNote: null },
      { heading: 'Funding', body: 'Money follows medals and medals follow money in a loop that compounds year after year.', sourceNote: null },
    ],
    practicalTakeaway: null,
    conclusion: 'Systems beat headcount.',
    disclaimer: null,
    sources: [],
    ...overrides,
  }).html;

const quiz = {
  title: 'Quiz',
  questions: [{ question: 'Q?', type: 'multiple_choice' as const, options: ['a', 'b'], correctOptionIndex: 0, explanation: 'a.', difficulty: 'easy' as const, sourceNote: null, claimIds: [] }],
  afterSectionIndex: 0,
};

describe('feedback → editorial patterns', () => {
  it('maps the editor phrasings from the spec onto reusable subjects', () => {
    const parsed = parseFeedbackDeterministically(
      'Too generic. Too many facts without interpretation. Needs more historical context. Table was useful. Quiz felt forced. Too much AI language. Need stronger counterargument. Conclusion repeated the introduction. Excellent hidden mechanism.',
    );
    expect(parsed).toEqual(
      expect.arrayContaining([
        { subject: 'generic', polarity: 'avoid' },
        { subject: 'numbers:more_interpretation', polarity: 'prefer' },
        { subject: 'context:more_history', polarity: 'prefer' },
        { subject: 'component:table', polarity: 'prefer' },
        { subject: 'component:quiz', polarity: 'avoid' },
        { subject: 'ai_language', polarity: 'avoid' },
        { subject: 'counterargument:stronger', polarity: 'prefer' },
        { subject: 'conclusion_repeats_intro', polarity: 'avoid' },
        { subject: 'mechanism:explain', polarity: 'prefer' },
      ]),
    );
  });

  it('turns "good opening" into the article\'s opening pattern, not praise for one article', () => {
    expect(parseFeedbackDeterministically('Good opening.', 'question')).toEqual([{ subject: 'opening:question_led', polarity: 'prefer' }]);
    expect(parseFeedbackDeterministically('Good opening.')).toEqual([]);
  });

  it('ignores article-specific remarks', () => {
    expect(parseFeedbackDeterministically('Fix the second paragraph, the date is wrong.')).toEqual([]);
  });
});

describe('learning from human edits', () => {
  it('extracts the editorial pattern of what changed, never the text', () => {
    const original = analyzeArticleHtml(article({ quiz }));
    const approved = analyzeArticleHtml(
      article({
        title: 'Why Does China Still Dominate?',
        sections: [
          { heading: 'What happened', body: 'Why does a country of 1.4 billion win so few medals?', sourceNote: null },
          { heading: 'The case against', body: 'India is improving.', sourceNote: null },
        ],
      }),
    );
    const signals = diffEditorialSignals(original, approved);
    const keys = signals.map((s) => `${s.subject}:${s.polarity}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        'component:quiz:avoid',
        'length:shorter:prefer',
        'sections:fewer:prefer',
        'opening:question_led:prefer',
        'counterargument:stronger:prefer',
        'headline:question_style:prefer',
      ]),
    );
    // Statements describe patterns; none contains the edited article's sentences.
    expect(signals.every((s) => !s.statement.includes('1.4 billion'))).toBe(true);
  });

  it('treats an unedited approval as weak acceptance of its own choices', () => {
    const signals = acceptanceSignals(analyzeArticleHtml(article({ quiz })));
    expect(signals.map((s) => s.subject)).toEqual(expect.arrayContaining(['component:quiz']));
  });
});

describe('style reference ingestion safety', () => {
  const source = 'The thing about Indian sport is that nobody talks about the coaches who quietly built the whole system over twenty years.';

  it('detects 8+ word verbatim runs', () => {
    expect(copiesSource('nobody talks about the coaches who quietly built the whole system', source)).toBe(true);
    expect(copiesSource('opens on an overlooked group of people, then widens to the system', source)).toBe(false);
  });

  it('drops traits that copy the source or run too long', () => {
    const cleaned = sanitizeTraits(
      {
        openingTechnique: 'The thing about Indian sport is that nobody talks about the coaches',
        transitionPatterns: ['short one-line pivots', 'x'.repeat(200)],
        conclusionPattern: 'ends on an uncomfortable question',
        evidenceUse: null,
        narrativeUse: null,
        conversationality: 8,
        editorialDepth: 7,
        directness: 8,
        skepticism: 7,
        warmth: 6,
        formality: 3,
      },
      source,
    );
    expect(cleaned.openingTechnique).toBeNull();
    expect(cleaned.transitionPatterns).toEqual(['short one-line pivots']);
    expect(cleaned.conclusionPattern).toBe('ends on an uncomfortable question');
  });
});

describe('memory weighting', () => {
  const memory = (overrides: Partial<EditorialMemory>): EditorialMemory => ({
    memoryId: '00000000-0000-4000-8000-0000000000d1',
    category: 'structure',
    subject: 'component:quiz',
    polarity: 'avoid',
    statement: 'Quizzes tend to feel forced; avoid them.',
    confidence: 0.85,
    source: 'explicit_feedback',
    status: 'CONFIRMED',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    lastUsedAt: null,
    timesConfirmed: 1,
    timesRejected: 0,
    validUntil: null,
    supersededById: null,
    evidence: [],
    ...overrides,
  });
  const now = new Date('2026-10-08T00:00:00Z');

  it('drops expired temporary, decayed inferred and superseded memories', () => {
    const active = activeMemories(
      [
        memory({ memoryId: '00000000-0000-4000-8000-0000000000d2', status: 'TEMPORARY', validUntil: '2026-10-01T00:00:00Z' }),
        memory({ memoryId: '00000000-0000-4000-8000-0000000000d3', status: 'INFERRED', confidence: 0.4, updatedAt: '2026-01-01T00:00:00Z' }),
        memory({ memoryId: '00000000-0000-4000-8000-0000000000d4', supersededById: '00000000-0000-4000-8000-0000000000d1' }),
        memory({ memoryId: '00000000-0000-4000-8000-0000000000d5' }),
      ],
      now,
    );
    expect(active.map((m) => m.memoryId)).toEqual(['00000000-0000-4000-8000-0000000000d5']);
  });

  it('renders confirmed as instructions, inferred as tentative and rejected as never-reintroduce', () => {
    const text = renderMemoriesForWriter([
      memory({}),
      memory({ status: 'INFERRED', subject: 'opening:question_led', statement: 'Open with a sharp question.' }),
      memory({ status: 'REJECTED', subject: 'component:poll', polarity: 'prefer', statement: 'Polls work for genuine reader self-identification.' }),
    ]);
    expect(text).toMatch(/Confirmed editorial preferences[\s\S]*Quizzes tend to feel forced/);
    expect(text).toMatch(/Tentative patterns[\s\S]*Open with a sharp question/);
    expect(text).toMatch(/never act on or reintroduce them:\n- Polls work/);
  });
});
