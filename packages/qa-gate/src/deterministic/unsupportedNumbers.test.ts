import { describe, expect, it } from 'vitest';

import { checkUnsupportedNumbers } from './unsupportedNumbers.js';

describe('checkUnsupportedNumbers', () => {
  const sources = ['Deposits took 52% of gross financial savings in FY71-80 and 33% by FY25.'];

  it('ignores labels (FY23) and decades (the 1970s)', () => {
    const r = checkUnsupportedNumbers('In the 1970s deposits took 52%; from FY23 onwards that fell to 33%.', sources, true);
    expect(r.status).toBe('PASS');
  });

  it('exempts a labelled worked example and its short arithmetic follow-ons', () => {
    const text = [
      'A purely illustrative household, with made-up round numbers: ₹10 lakh saved, 70% in deposits.',
      'After one year, deposits are ₹7.33 lakh of ₹11 lakh, about 67%.',
      'After five years, they are ₹8.65 lakh of ₹15 lakh, about 58%.',
      'Deposits took 52% of savings in FY71-80.',
    ].join('\n\n');
    expect(checkUnsupportedNumbers(text, sources, true).status).toBe('PASS');
  });

  it('still flags an unsourced figure outside any illustration', () => {
    const r = checkUnsupportedNumbers('Deposits now take 41% of savings.', sources, true);
    expect(r.status).toBe('FAIL');
    expect(r.evidence).toContain('41%');
  });

  it('ignores a trailing list comma and matches a figure written another way in the source', () => {
    const text = 'The DICGC insures each depositor up to ₹5,00,000, principal and interest combined.';
    expect(checkUnsupportedNumbers(text, ['Deposits are insured up to Rs 5 lakh per depositor.'], true).status).toBe('PASS');
  });
});
