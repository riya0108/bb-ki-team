import { describe, expect, it } from 'vitest';

import { buildArticleHtml, slugify } from './htmlBuilder.js';

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

  it('generates one h2 per section plus practical-takeaway, conclusion, and sources', () => {
    const { html } = buildArticleHtml(baseInput);
    const h2Count = (html.match(/<h2[\s>]/g) ?? []).length;
    // 2 sections + "what this means for you" + "bottom line" + "sources" (baseInput has 1 source)
    expect(h2Count).toBe(5);
  });

  it('every TOC link points to a real anchor id in the document', () => {
    const { html, headingIds } = buildArticleHtml(baseInput);
    expect(headingIds).toEqual(['the-proposal', 'who-pays']);
    for (const id of headingIds) {
      expect(html).toContain(`href="#${id}"`);
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

  it('omits the disclaimer and sources sections entirely when not provided', () => {
    const { html } = buildArticleHtml({ ...baseInput, disclaimer: null, sources: [] });
    expect(html).not.toContain('class="disclaimer"');
    expect(html).not.toContain('id="sources"');
  });

  it('includes a disclaimer when supplied', () => {
    const { html } = buildArticleHtml({ ...baseInput, disclaimer: 'Not financial advice.' });
    expect(html).toContain('Not financial advice.');
  });
});
