import { describe, expect, it } from 'vitest';

import { illustrationRanges, illustrativeQuantities } from './illustrations.js';
import { extractQuantities, isMaterialQuantity, type Quantity, quantitiesMatch } from './quantities.js';

const FD_EXAMPLE = [
  'In September the fresh deposit rate was 5.61% and October CPI inflation was 6.09%.',
  'An illustration, not a forecast',
  'Assume you put ₹1,00,000 into a one-year FD at 5.61%, with simple annual interest. You earn ₹5,610, so the maturity value is ₹1,05,610. Now assume prices rise 6.09% over the same year. A basket that cost ₹1,00,000 at the start costs ₹1,06,090 at the end.',
  'Your money grew by ₹5,610. The basket grew by ₹6,090. Measured in what your savings can buy, you finish about ₹480 behind.',
  'Elsewhere, deposits grew 16.76%.',
].join('\n\n');

function unaccounted(text: string, evidenceText: string): string[] {
  const evidence = extractQuantities(evidenceText);
  const qs = extractQuantities(text).filter(isMaterialQuantity);
  const isSupported = (q: Quantity): boolean => evidence.some((e) => quantitiesMatch(q, e));
  const worked = illustrativeQuantities(text, qs, isSupported);
  return qs.filter((q) => !isSupported(q) && !worked.has(q)).map((q) => q.raw);
}

describe('illustrativeQuantities', () => {
  it("accepts a labelled worked example's round inputs and its own arithmetic", () => {
    expect(unaccounted(FD_EXAMPLE, 'fresh deposits 5.61%; CPI 6.09%')).toEqual(['16.76%']);
  });

  it('accepts sums of assumed holdings against a sourced limit', () => {
    const text = 'Assume you hold ₹4 lakh in an FD at one branch and ₹3 lakh in savings at another. You have ₹7 lakh with that bank, but only ₹5 lakh is covered.';
    expect(unaccounted(text, 'insured up to ₹5,00,000')).toEqual([]);
  });

  it('does not excuse an unsourced rate or a non-round figure the arithmetic cannot produce', () => {
    const text = 'Assume you put ₹1,00,000 in an FD at 7.35%. You would earn ₹9,912.';
    expect(unaccounted(text, '')).toEqual(['7.35%', '₹9,912']);
  });

  it('only opens a span on a labelled paragraph', () => {
    expect(illustrationRanges('Deposits rose to ₹7 lakh.\n\nSavers earned ₹5,610.')).toEqual([]);
  });
});
