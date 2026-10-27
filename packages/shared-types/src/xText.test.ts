import { describe, expect, it } from 'vitest';

import { fitsXPost, X_MAX_POST_LENGTH, xPostLength } from './xText.js';

describe('xPostLength', () => {
  it('counts plain Latin text one per character', () => {
    expect(xPostLength('UPI is free. For you.')).toBe(21);
  });

  it('counts ₹ and arrows as two, Devanagari as one', () => {
    expect(xPostLength('₹')).toBe(2);
    expect(xPostLength('→')).toBe(2);
    expect(xPostLength('पैसा')).toBe(4);
  });

  it('counts an emoji, including ZWJ sequences, as two', () => {
    expect(xPostLength('🚀')).toBe(2);
    expect(xPostLength('👨‍👩‍👧')).toBe(2);
  });

  it('counts any URL as 23', () => {
    expect(xPostLength(`Read: https://example.com/${'x'.repeat(100)}`)).toBe(6 + 23);
  });

  it('fits exactly at the limit and not one over', () => {
    expect(fitsXPost('a'.repeat(X_MAX_POST_LENGTH))).toBe(true);
    expect(fitsXPost(`${'a'.repeat(X_MAX_POST_LENGTH - 1)}₹`)).toBe(false);
  });
});
