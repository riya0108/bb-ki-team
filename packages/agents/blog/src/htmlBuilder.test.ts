import { describe, expect, it } from 'vitest';

import { buildArticleHtml, INTERACTIVE_SCRIPT, slugify } from './htmlBuilder.js';

describe('slugify', () => {
  it('lowercases, strips punctuation, and hyphenates', () => {
    expect(slugify('Why UPI Fees Are About To Change!')).toBe('why-upi-fees-are-about-to-change');
  });

  it('collapses repeated whitespace/hyphens', () => {
    expect(slugify('Too   many   spaces -- here')).toBe('too-many-spaces-here');
  });
});

describe('buildArticleHtml', () => {
  const baseInput = {
    title: 'Why UPI Fees Are About To Change',
    deck: 'What the RBI proposal actually changes.',
    category: 'Personal Finance',
    metaDescription: 'A look at the RBI UPI fee proposal.',
    sections: [
      { heading: 'The proposal', body: 'RBI proposed a fee change.', sourceNote: 'RBI announcement, 2026.' },
      { heading: 'Who pays', body: 'Merchants and banks split it.\n\nA second paragraph here.', sourceNote: null },
    ],
    practicalTakeaway: 'Watch your next bill for a small increase.',
    conclusion: 'The fee hike is a split tax.',
    disclaimer: null,
    sources: ['https://example.com/rbi-notice'],
  };

  it('produces exactly one h1', () => {
    const { html } = buildArticleHtml(baseInput);
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(html).toContain('<h1>Why UPI Fees Are About To Change</h1>');
  });

  it('embeds the meta description and page title', () => {
    const { html } = buildArticleHtml(baseInput);
    expect(html).toContain('<meta name="description" content="A look at the RBI UPI fee proposal.">');
    expect(html).toContain('<title>Why UPI Fees Are About To Change</title>');
  });

  it('generates one h2 per section plus practical-takeaway and conclusion', () => {
    const { html } = buildArticleHtml(baseInput);
    const h2Count = (html.match(/<h2[\s>]/g) ?? []).length;
    // 2 sections + "what this means for you" + "bottom line"
    expect(h2Count).toBe(4);
  });

  it('gives each section a unique heading id', () => {
    const { html, headingIds } = buildArticleHtml(baseInput);
    expect(headingIds).toEqual(['the-proposal', 'who-pays']);
    for (const id of headingIds) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('disambiguates two sections with the same heading text into distinct ids', () => {
    const { headingIds } = buildArticleHtml({
      ...baseInput,
      sections: [
        { heading: 'The catch', body: 'First.', sourceNote: null },
        { heading: 'The catch', body: 'Second.', sourceNote: null },
      ],
    });
    expect(headingIds).toEqual(['the-catch', 'the-catch-1']);
  });

  it('splits body text into separate <p> tags on blank lines', () => {
    const { html } = buildArticleHtml(baseInput);
    expect(html).toContain('<p>Merchants and banks split it.</p>');
    expect(html).toContain('<p>A second paragraph here.</p>');
  });

  it('escapes HTML-significant characters in title/body rather than injecting raw markup', () => {
    const { html } = buildArticleHtml({
      ...baseInput,
      title: 'Is <script>alert(1)</script> a real headline?',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('omits the disclaimer and emits no <script> when no interactive widgets are supplied', () => {
    const { html } = buildArticleHtml({ ...baseInput, disclaimer: null, sources: [] });
    expect(html).not.toContain('class="disclaimer"');
    expect(html).not.toContain('<script>');
  });

  it('includes a disclaimer when supplied', () => {
    const { html } = buildArticleHtml({ ...baseInput, disclaimer: 'Not financial advice.' });
    expect(html).toContain('Not financial advice.');
  });

  it('renders a comparison-stat widget after the requested section', () => {
    const { html } = buildArticleHtml({
      ...baseInput,
      comparisonStat: {
        label: 'Guess vs. reality',
        leftValue: '$86',
        leftCaption: 'the average guess',
        rightValue: '$219',
        rightCaption: 'the actual total',
        footnote: 'A $133 gap nobody chose.',
        afterSectionIndex: 0,
      },
    });
    expect(html).toContain('gap-widget');
    expect(html).toContain('$86');
    expect(html).toContain('$219');
    const proposalIndex = html.indexOf('id="the-proposal"');
    const whoPaysIndex = html.indexOf('id="who-pays"');
    const widgetIndex = html.indexOf('class="gap-widget"');
    expect(widgetIndex).toBeGreaterThan(proposalIndex);
    expect(widgetIndex).toBeLessThan(whoPaysIndex);
  });

  it('renders 3-6 reveal cards and emits the interactive script', () => {
    const { html } = buildArticleHtml({
      ...baseInput,
      revealCards: {
        title: '3 things nobody tells you',
        afterSectionIndex: 1,
        cards: [
          { icon: '🔄', teaser: 'The one that renews', title: 'The Ghost', text: 'It renews itself.' },
          { icon: '👆', teaser: 'The one you miss', title: 'The Tap', text: 'You never feel it.' },
          { icon: '💤', teaser: 'The one that sits', title: 'Idle Money', text: 'It just sits there.' },
        ],
      },
    });
    expect((html.match(/class="flip-card"/g) ?? []).length).toBe(3);
    expect(html).toContain('The Ghost');
    expect(html).toContain(`<script>\n${INTERACTIVE_SCRIPT}\n</script>`);
    // odd count -> last card centered via inline style
    expect(html).toContain('grid-column: 1 / -1');
  });

  it('renders a two-option poll with both reveal panels pre-rendered', () => {
    const { html } = buildArticleHtml({
      ...baseInput,
      poll: {
        question: 'How often do you check your statement?',
        afterSectionIndex: 0,
        options: [
          { label: 'Every week', revealText: 'You are ahead of most people.' },
          { label: 'Rarely', revealText: 'You are in the majority.' },
        ],
      },
    });
    expect(html).toContain('data-choice="opt-0"');
    expect(html).toContain('data-choice="opt-1"');
    expect(html).toContain('You are ahead of most people.');
    expect(html).toContain('You are in the majority.');
    expect(html).toContain(INTERACTIVE_SCRIPT);
  });

  it('renders a pull quote as a blockquote', () => {
    const { html } = buildArticleHtml({
      ...baseInput,
      pullQuote: { text: 'Awareness is not the same as restriction.', afterSectionIndex: 1 },
    });
    expect(html).toContain('<blockquote><p>Awareness is not the same as restriction.</p></blockquote>');
  });

  it('clamps an out-of-range afterSectionIndex to the last section', () => {
    const { html } = buildArticleHtml({
      ...baseInput,
      pullQuote: { text: 'Clamped quote.', afterSectionIndex: 99 },
    });
    const whoPaysIndex = html.indexOf('id="who-pays"');
    const quoteIndex = html.indexOf('Clamped quote.');
    expect(quoteIndex).toBeGreaterThan(whoPaysIndex);
  });
});
