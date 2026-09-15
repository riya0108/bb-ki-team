import { describe, expect, it } from 'vitest';

import { buildMdxFileContents } from './mdxFile.js';

describe('buildMdxFileContents', () => {
  it('renders frontmatter and body matching the site content collection schema', () => {
    const mdx = buildMdxFileContents(
      {
        title: 'Why "no-cost EMI" isn\'t free',
        description: 'A look at who actually pays.',
        categorySlug: 'personal-finance',
        tags: [],
        pubDateIso: '2026-09-15T12:00:00.000Z',
        authorName: 'Bull or Bear Blogs',
        authorBio: 'The editorial desk.',
      },
      '<section><h2>Heading</h2><p>Body.</p></section>',
    );

    expect(mdx).toContain('title: "Why \\"no-cost EMI\\" isn\'t free"');
    expect(mdx).toContain('category: personal-finance');
    expect(mdx).toContain('pubDate: 2026-09-15');
    expect(mdx).toContain('draft: false');
    expect(mdx).toContain('<section><h2>Heading</h2><p>Body.</p></section>');
    expect(mdx.startsWith('---\n')).toBe(true);
  });

  it('serializes a non-empty tags array', () => {
    const mdx = buildMdxFileContents(
      {
        title: 'T',
        description: 'D',
        categorySlug: 'money',
        tags: ['UPI', 'Banking'],
        pubDateIso: '2026-01-01T00:00:00.000Z',
        authorName: 'A',
        authorBio: 'B',
      },
      'body',
    );
    expect(mdx).toContain('tags: ["UPI", "Banking"]');
  });
});
