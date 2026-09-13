import { describe, expect, it } from 'vitest';

import { buildArticleHtml } from './htmlBuilder.js';
import { validateBlogHtml } from './htmlValidation.js';

const validInput = {
  title: 'A Valid Title',
  deck: 'A deck.',
  category: 'Tech',
  sections: [{ heading: 'Section one', body: 'Body text.', sourceNote: null }],
  practicalTakeaway: null,
  conclusion: 'Conclusion text.',
  disclaimer: null,
  sources: [],
};

describe('validateBlogHtml', () => {
  it('passes a document built by buildArticleHtml', () => {
    const { html } = buildArticleHtml(validInput);
    const result = validateBlogHtml(html);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('fails when there is more than one h1', () => {
    const { html } = buildArticleHtml(validInput);
    const withExtraH1 = html.replace('<main>', '<main><h1>Extra</h1>');
    const result = validateBlogHtml(withExtraH1);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('one <h1>'))).toBe(true);
  });

  it('fails when a script tag is present', () => {
    const { html } = buildArticleHtml(validInput);
    const withScript = html.replace('</article>', '<script>alert(1)</script></article>');
    const result = validateBlogHtml(withScript);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('script'))).toBe(true);
  });

  it('fails when an img tag is missing alt text', () => {
    const { html } = buildArticleHtml(validInput);
    const withImg = html.replace('</main>', '<img src="x.png"></main>');
    const result = validateBlogHtml(withImg);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('alt'))).toBe(true);
  });

  it('passes when an img tag has alt text', () => {
    const { html } = buildArticleHtml(validInput);
    const withImg = html.replace('</main>', '<img src="x.png" alt="A chart"></main>');
    const result = validateBlogHtml(withImg);
    expect(result.valid).toBe(true);
  });
});
