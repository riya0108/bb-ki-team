import type { DecisionComponent, QuizComponent, TableComponent, TimelineComponent } from '@bb/shared-types';
import { blogPostFragmentFromHtml } from '@bb/mcp-client';
import { describe, expect, it } from 'vitest';

import { analyzeArticleHtml } from './editorial/styleMetrics.js';
import { buildArticleHtml, INTERACTIVE_SCRIPT } from './htmlBuilder.js';
import { countComponents, validateBlogHtml } from './htmlValidation.js';

const base = {
  title: 'Why China Still Dominates the Asian Games',
  deck: 'Population is not the same as sporting depth.',
  category: 'Sport & Economics',
  metaDescription: 'Why population does not translate into medals.',
  sections: [
    { heading: 'The basic facts', body: 'China won 383 medals.\n\nIndia won 106.', sourceNote: 'Source: OCA, October 2023' },
    { heading: 'The mechanism', body: 'Sports schools identify talent early.', sourceNote: null },
    { heading: 'The counterargument', body: 'India improved sharply.', sourceNote: null },
  ],
  practicalTakeaway: null,
  conclusion: 'Medals follow systems, not headcounts.',
  disclaimer: null,
  sources: [],
};

const table: TableComponent = {
  kind: 'country_comparison',
  title: 'India vs China at Hangzhou 2022',
  subtitle: 'Medal table, final',
  columns: [
    { label: 'Metric', align: 'left' },
    { label: 'India', align: 'right' },
    { label: 'China', align: 'right' },
  ],
  rows: [
    ['Total medals', '106', '383'],
    ['Gold medals', '28', '201'],
  ],
  sourceNote: 'Source: Olympic Council of Asia, October 2023',
  footnote: null,
  claimIds: ['claim_001'],
  afterSectionIndex: 0,
};

const quiz: QuizComponent = {
  title: 'Check what you just read',
  questions: [
    {
      question: 'How many total medals did China win?',
      type: 'multiple_choice',
      options: ['106', '201', '383', '469'],
      correctOptionIndex: 2,
      explanation: 'China won 383 medals, including 201 golds.',
      difficulty: 'easy',
      sourceNote: 'OCA, October 2023',
      claimIds: ['claim_001'],
    },
    {
      question: 'Did India win more than 100 medals?',
      type: 'true_false',
      options: ['True', 'False'],
      correctOptionIndex: 0,
      explanation: 'India won 106.',
      difficulty: 'easy',
      sourceNote: null,
      claimIds: ['claim_002'],
    },
  ],
  afterSectionIndex: 1,
};

const decision: DecisionComponent = {
  title: 'You are the sports minister',
  question: 'Where would you spend the next rupee?',
  options: [
    { label: 'Grassroots coaching', revealTitle: 'The slow build', revealText: 'Pays off over a decade.', evidenceNote: null },
    { label: 'Elite athletes', revealTitle: 'The quick win', revealText: 'More medals sooner, thinner base.', evidenceNote: 'TOPS funds elite athletes.' },
  ],
  claimIds: [],
  afterSectionIndex: 2,
};

const timeline: TimelineComponent = {
  title: 'How India got here',
  events: [
    { date: '2014', title: 'TOPS launched', description: 'Elite athlete support begins.', sourceNote: null },
    { date: '2018', title: 'Khelo India', description: 'Grassroots programme.', sourceNote: 'PIB' },
    { date: '2023', title: '106 medals', description: 'Best-ever haul.', sourceNote: null },
  ],
  claimIds: [],
  afterSectionIndex: 0,
};

describe('table component', () => {
  it('renders semantic, scrollable, labelled table markup with numeric alignment', () => {
    const { html, components } = buildArticleHtml({ ...base, table });
    expect(html).toContain('<table class="data-table"><thead><tr><th scope="col">Metric</th><th scope="col" class="num">India</th>');
    expect(html).toContain('<th scope="row">Total medals</th><td class="num">106</td><td class="num">383</td>');
    expect(html).toContain('<div class="table-wrap" role="region" aria-label="India vs China at Hangzhou 2022 (scrolls horizontally)" tabindex="0">');
    expect(html).toContain('Source: Olympic Council of Asia, October 2023');
    expect(components).toEqual(['table']);
    // A static table needs no script.
    expect(html).not.toContain('<script>');
    expect(validateBlogHtml(html)).toEqual({ valid: true, issues: [] });
  });

  it('escapes every cell — no arbitrary HTML can enter a table', () => {
    const evil: TableComponent = { ...table, rows: [['<img src=x onerror=alert(1)>', '{danger}', '1'], ['b', 'c', 'd']] };
    const { html } = buildArticleHtml({ ...base, table: evil });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&#123;danger&#125;');
    expect(validateBlogHtml(html).valid).toBe(true);
  });
});

describe('quiz component', () => {
  it('marks exactly one correct option per question and pre-renders hidden feedback', () => {
    const { html } = buildArticleHtml({ ...base, quiz });
    const questions = html.split('<div class="quiz-q">').slice(1);
    expect(questions).toHaveLength(2);
    for (const q of questions) {
      expect((q.match(/data-correct="true"/g) ?? []).length).toBe(1);
      expect(q).toMatch(/<div class="quiz-result" data-result="correct" hidden>/);
      expect(q).toMatch(/<div class="quiz-result" data-result="incorrect" hidden>/);
    }
    expect(html).toContain('Not quite. The answer is C: 383.');
    expect(html).toContain('<div class="quiz-feedback" aria-live="polite">');
    expect(html).toContain('role="group" aria-labelledby="bb-quiz-q-1"');
    expect(html).toContain(`<script>\n${INTERACTIVE_SCRIPT}\n</script>`);
    expect(validateBlogHtml(html).valid).toBe(true);
  });

  it('uses native buttons so Enter and Space work from the keyboard', () => {
    const { html } = buildArticleHtml({ ...base, quiz });
    const buttons = html.match(/<button[^>]*class="quiz-opt"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(6);
    expect(buttons.every((b) => b.includes('type="button"') && b.includes('aria-pressed="false"'))).toBe(true);
  });
});

describe('decision component', () => {
  it('renders one button and one hidden reveal per option', () => {
    const { html } = buildArticleHtml({ ...base, decision });
    expect((html.match(/class="decision-btn"/g) ?? []).length).toBe(2);
    expect((html.match(/<div class="decision-reveal" data-choice="opt-\d" hidden>/g) ?? []).length).toBe(2);
    expect(html).toContain('TOPS funds elite athletes.');
    expect(html).toContain('aria-labelledby="bb-decision-q"');
    expect(validateBlogHtml(html).valid).toBe(true);
  });
});

describe('timeline component', () => {
  it('renders an ordered list in the given order', () => {
    const { html } = buildArticleHtml({ ...base, timeline });
    expect(html).toContain('<ol class="timeline">');
    expect(html.indexOf('TOPS launched')).toBeLessThan(html.indexOf('Khelo India'));
    expect(html).not.toContain('<script>');
  });
});

describe('flip cards and poll (upgraded)', () => {
  it('flip cards stay keyboard-operable buttons and show optional number/source', () => {
    const { html } = buildArticleHtml({
      ...base,
      revealCards: {
        title: 'Guess before you reveal',
        afterSectionIndex: 0,
        cards: [
          { icon: '🥇', teaser: 'China golds', number: '201', title: 'Gold', text: 'Most of any nation.', sourceNote: 'OCA' },
          { icon: '🇮🇳', teaser: 'India total', title: 'Total', text: '106 medals.' },
          { icon: '🏫', teaser: 'Sports schools', title: 'Pipeline', text: 'Early identification.' },
        ],
      },
    });
    expect(html).toContain('class="flip-card" tabindex="0" role="button" aria-pressed="false" aria-label="Reveal card 1: China golds"');
    expect(html).toContain('<div class="big-num">201</div>');
    expect(html).toContain('<div class="b-source">OCA</div>');
    expect(INTERACTIVE_SCRIPT).toContain("event.key === 'Enter' || event.key === ' '");
  });

  it('poll buttons expose pressed state and reveals sit in a live region', () => {
    const { html } = buildArticleHtml({
      ...base,
      poll: {
        question: 'Would you trade headcount for coaching?',
        afterSectionIndex: 0,
        options: [
          { label: 'Yes', revealText: 'Most systems did.' },
          { label: 'No', revealText: 'Then the gap stays.' },
        ],
      },
    });
    expect(html).toContain('<button class="poll-btn" type="button" data-choice="opt-0" aria-pressed="false">Yes</button>');
    expect(html).toContain('<div aria-live="polite">');
  });
});

describe('document structure', () => {
  it('renders no widgets and no script when every component is null', () => {
    const { html, components } = buildArticleHtml({ ...base, table: null, quiz: null, decision: null, timeline: null, poll: null, revealCards: null });
    expect(components).toEqual([]);
    expect(html).not.toContain('<script>');
    expect(countComponents(html)).toEqual({ table: 0, revealCards: 0, quiz: 0, poll: 0, decision: 0, comparisonStat: 0, pullQuote: 0, timeline: 0 });
  });

  it('keeps every widget inside <main class="essay"> (what the publisher copies into MDX)', () => {
    const { html } = buildArticleHtml({ ...base, table, quiz, decision, timeline, shortVersion: ['China won 383.', 'India won 106.'] });
    const main = /<main class="essay">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
    for (const marker of ['table-figure', 'class="quiz"', 'class="decision"', 'timeline-wrap', 'short-version']) {
      expect(main).toContain(marker);
    }
    expect((html.match(/<script/g) ?? []).length).toBe(1);
  });

  it('renders clean source labels as links, never raw URLs in the text', () => {
    const { html } = buildArticleHtml({
      ...base,
      sourceLinks: [
        { label: 'Reuters, October 8, 2026', url: 'https://www.reuters.com/x' },
        { label: 'Government of India', url: null },
        { label: 'Bad', url: 'javascript:alert(1)' },
      ],
    });
    expect(html).toContain('<a href="https://www.reuters.com/x" rel="nofollow noopener noreferrer" target="_blank">Reuters, October 8, 2026</a>');
    expect(html).toContain('<li>Government of India</li>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<div class="sources-title">Sources</div>');
  });

  it('injects an internal link on the first occurrence of its anchor only', () => {
    const { html } = buildArticleHtml({
      ...base,
      internalLinks: [{ anchorText: 'Sports schools', url: 'https://bullorbear.in/sport/sports-schools/' }],
    });
    expect(html).toContain('<a href="https://bullorbear.in/sport/sports-schools/">Sports schools</a> identify talent early.');
    expect((html.match(/<a href="https:\/\/bullorbear\.in/g) ?? []).length).toBe(1);
  });

  it('round-trips through the HTML analyzer used for learning and style metrics', () => {
    const { html } = buildArticleHtml({ ...base, table, quiz });
    const analysis = analyzeArticleHtml(html);
    expect(analysis.title).toBe(base.title);
    expect(analysis.components).toEqual(['table', 'quiz']);
    expect(analysis.shape.headings).toEqual(['The basic facts', 'The mechanism', 'The counterargument']);
    expect(analysis.shape.opening).toBe('China won 383 medals.\n\nIndia won 106.');
    expect(analysis.shape.ending).toBe('Medals follow systems, not headcounts.');
  });
});

describe('validateBlogHtml — editorial upgrade checks', () => {
  const valid = buildArticleHtml({ ...base, quiz }).html;

  it('rejects a second quiz (component limits)', () => {
    const doubled = valid.replace('<div class="quiz">', '<div class="quiz"></div><div class="quiz">');
    const result = validateBlogHtml(doubled);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('Too many quiz'))).toBe(true);
  });

  it('rejects more than three click-to-answer widgets', () => {
    const { html } = buildArticleHtml({
      ...base,
      quiz,
      decision,
      poll: { question: 'Q?', afterSectionIndex: 0, options: [{ label: 'a', revealText: 'b' }, { label: 'c', revealText: 'd' }] },
      revealCards: {
        title: 'Cards',
        afterSectionIndex: 0,
        cards: [
          { icon: '1', teaser: 'a', title: 'a', text: 'a' },
          { icon: '2', teaser: 'b', title: 'b', text: 'b' },
          { icon: '3', teaser: 'c', title: 'c', text: 'c' },
        ],
      },
    });
    expect(validateBlogHtml(html).issues.some((i) => i.includes('interactive widgets'))).toBe(true);
  });

  it('rejects a tampered or second script, inline handlers and javascript: URLs', () => {
    expect(validateBlogHtml(valid.replace("each('.quiz'", "fetch('https://evil');each('.quiz'")).valid).toBe(false);
    expect(validateBlogHtml(valid.replace('</body>', '<script>alert(1)</script></body>')).issues.some((i) => i.includes('<script> tags'))).toBe(true);
    expect(validateBlogHtml(valid.replace('<div class="quiz">', '<div class="quiz" onmouseenter="x()">')).valid).toBe(false);
    expect(validateBlogHtml(valid.replace('</main>', '<a href="javascript:alert(1)">x</a></main>')).valid).toBe(false);
    expect(validateBlogHtml(valid.replace('</main>', '<iframe src="https://x"></iframe></main>')).valid).toBe(false);
  });

  it('requires type="button" on buttons and headers on tables', () => {
    expect(validateBlogHtml(valid.replace('<button type="button" class="quiz-opt"', '<button class="quiz-opt"')).valid).toBe(false);
    const withTable = buildArticleHtml({ ...base, table }).html;
    expect(validateBlogHtml(withTable.replace('<thead>', '<tbody>').replace('</thead>', '</tbody>')).valid).toBe(false);
  });

  it('flags interactive widgets without the script', () => {
    expect(validateBlogHtml(valid.replace(/<script>[\s\S]*<\/script>/, '')).issues.some((i) => i.includes('script is missing'))).toBe(true);
  });
});

describe('publishing compatibility', () => {
  it('the blog publisher extracts every widget, the sources list and the single script into MDX', () => {
    const { html } = buildArticleHtml({
      ...base,
      table,
      quiz,
      decision,
      sections: [{ heading: 'Braces', body: 'A {literal} brace must not become an MDX expression.', sourceNote: null }],
      sourceLinks: [{ label: 'Reuters, October 8, 2026', url: 'https://www.reuters.com/x' }],
    });
    const fragment = blogPostFragmentFromHtml(html);
    expect(fragment.title).toBe(base.title);
    expect(fragment.bodyMdx).toContain('<figure class="table-figure">');
    expect(fragment.bodyMdx).toContain('<div class="quiz">');
    expect(fragment.bodyMdx).toContain('<div class="decision">');
    expect(fragment.bodyMdx).toContain('Reuters, October 8, 2026');
    expect((fragment.bodyMdx.match(/<script>/g) ?? []).length).toBe(1);
    // Outside the <style>/<script> template literals, no raw brace survives.
    const prose = fragment.bodyMdx.replace(/<(style|script)>[\s\S]*?<\/\1>/g, '');
    expect(prose).not.toMatch(/[{}]/);
  });
});
