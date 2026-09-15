import { describe, expect, it } from 'vitest';

import { resolveCategorySlug } from './categories.js';

const VALID_SLUGS = ['ai', 'tech', 'money', 'finance', 'politics', 'personal-finance', 'world', 'business', 'lifestyle'];

describe('resolveCategorySlug', () => {
  it('matches an already-valid slug exactly, case/spacing insensitive', () => {
    expect(resolveCategorySlug('Personal Finance', VALID_SLUGS)).toEqual({
      slug: 'personal-finance',
      exactMatch: true,
    });
  });

  it('maps a freeform category by keyword', () => {
    expect(resolveCategorySlug('Investing & Markets', VALID_SLUGS)).toEqual({ slug: 'money', exactMatch: false });
    expect(resolveCategorySlug('War & Global Conflict', VALID_SLUGS)).toEqual({ slug: 'world', exactMatch: false });
  });

  it('falls back to business when nothing matches', () => {
    expect(resolveCategorySlug('Safety & Standards', VALID_SLUGS)).toEqual({ slug: 'business', exactMatch: false });
  });

  it('falls back to the first valid slug if business is not present', () => {
    const slugs = ['ai', 'tech'];
    expect(resolveCategorySlug('Safety & Standards', slugs)).toEqual({ slug: 'ai', exactMatch: false });
  });
});
