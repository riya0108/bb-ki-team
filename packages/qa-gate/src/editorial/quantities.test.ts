import { describe, expect, it } from 'vitest';

import { extractQuantities, supportFor } from './quantities.js';

function only(text: string): { value: number; unit: string } {
  const [q] = extractQuantities(text);
  if (!q) throw new Error(`no quantity in "${text}"`);
  return { value: q.value, unit: q.unit };
}

describe('extractQuantities', () => {
  it('distinguishes 25, 25%, ₹25 lakh and 25 basis points', () => {
    expect(only('rates rose 25')).toEqual({ value: 25, unit: 'plain' });
    expect(only('rates rose 25%')).toEqual({ value: 25, unit: 'percent' });
    expect(only('a ₹25 lakh loan')).toEqual({ value: 2_500_000, unit: 'inr' });
    expect(only('a 25 basis points hike')).toEqual({ value: 25, unit: 'bps' });
    expect(only('a 25 bps hike')).toEqual({ value: 25, unit: 'bps' });
  });

  it('normalizes scales and formatting', () => {
    expect(only('$150 billion')).toEqual({ value: 150e9, unit: 'usd' });
    expect(only('Rs 2 crore')).toEqual({ value: 2e7, unit: 'inr' });
    expect(only('repo rate at 5.50%').value).toBe(5.5);
    expect(only('1,000 jobs')).toEqual({ value: 1000, unit: 'plain' });
  });

  it('reads years and durations', () => {
    expect(only('since 2023')).toEqual({ value: 2023, unit: 'year' });
    expect(only('in 4 years')).toEqual({ value: 4, unit: 'duration_years' });
  });
});

describe('supportFor', () => {
  const evidence = extractQuantities('RBI raised the repo rate by 25 basis points to 5.50%, the first hike since 2023.');

  it('supports exact value + unit matches', () => {
    for (const q of extractQuantities('a 25 bps hike to 5.5% for the first time since 2023')) {
      expect(supportFor(q, evidence)).toBe('supported');
    }
  });

  it('flags a unit swap rather than calling it supported', () => {
    const [q] = extractQuantities('rates jumped 25%');
    if (!q) throw new Error('expected a quantity');
    expect(supportFor(q, evidence)).toBe('unit_mismatch');
  });

  it('flags numbers that appear nowhere in the evidence', () => {
    const [q] = extractQuantities('EMIs will rise by ₹4,000');
    if (!q) throw new Error('expected a quantity');
    expect(supportFor(q, evidence)).toBe('unsupported');
  });
});
