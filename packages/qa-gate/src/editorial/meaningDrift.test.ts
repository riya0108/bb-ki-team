import type { Claim, TemporalStatus } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { detectMeaningDrift } from './meaningDrift.js';

function claim(
  id: string,
  text: string,
  overrides: Partial<Omit<Claim, 'temporalContext'>> & { temporal?: TemporalStatus; qualifier?: string } = {},
): Claim {
  const { temporal, qualifier, ...rest } = overrides;
  return {
    id,
    text,
    type: 'FACT',
    verificationStatus: 'VERIFIED',
    confidence: 0.95,
    importance: 9,
    origin: 'research',
    sourceIds: ['source_1'],
    evidence: [],
    entities: [],
    numbers: [],
    dates: [],
    temporalContext: {
      status: temporal ?? 'completed',
      qualifier: qualifier ?? null,
      claimDate: null,
      sourceDate: null,
      validFrom: null,
      validUntil: null,
    },
    attributedTo: null,
    mustPreserve: true,
    allowedParaphrase: [],
    conflictingClaimIds: [],
    notes: null,
    ...rest,
  };
}

function rules(text: string, claims: Claim[]): string[] {
  return detectMeaningDrift(text, claims).map((i) => i.rule);
}

describe('detectMeaningDrift — RBI regression (first since 2023 must never become "again")', () => {
  const rbi = claim('claim_rbi_001', 'This was the first RBI rate hike since 2023.', {
    entities: ['RBI'],
    temporal: 'first_since',
    qualifier: 'first time since 2023',
  });

  it.each([
    'RBI just hiked rates again.',
    'RBI raised rates once more.',
    'RBI continues hiking rates.',
    'RBI has resumed a rate-hiking cycle.',
    'RBI hikes rates yet again, and borrowers will feel it.',
  ])('flags "%s" as temporal drift', (draft) => {
    expect(rules(draft, [rbi])).toContain('novelty_to_repetition');
  });

  it('flags turning the completed hike into a possibility ("RBI may hike rates")', () => {
    expect(rules('RBI may hike rates.', [rbi])).toContain('completed_to_possibility');
  });

  it('flags "first ever" when the fact is only "first since 2023"', () => {
    expect(rules('RBI just made its first-ever rate hike.', [rbi])).toContain('first_since_to_first_ever');
  });

  it('accepts hooks that preserve the temporal fact', () => {
    expect(
      detectMeaningDrift(
        "RBI just hiked rates for the first time since 2023, and if you have a home or car loan, here's why your EMI could be affected.",
        [rbi],
      ),
    ).toEqual([]);
    expect(
      detectMeaningDrift(
        'RBI just hiked rates for the first time in nearly four years. If you have a home or car loan, your EMI may be affected.',
        [rbi],
      ),
    ).toEqual([]);
  });

  it('allows a resumed cycle only when research independently verified one', () => {
    const cycle = claim('claim_cycle', 'Economists say RBI has begun a new rate-hiking cycle.', {
      entities: ['RBI'],
      temporal: 'recurring',
      mustPreserve: false,
    });
    // The novelty claim still forbids "again" for the hike itself...
    expect(rules('RBI hiked rates again.', [rbi, cycle])).toContain('novelty_to_repetition');
  });
});

describe('detectMeaningDrift — semantic trap dataset (spec 41)', () => {
  it('CASE A: expected launch is not a launch', () => {
    const c = claim('a', 'The company is expected to launch the product next month.', { temporal: 'expected' });
    expect(rules('The company launched the product.', [c])).toContain('expected_to_completed');
    expect(detectMeaningDrift('The company is expected to launch the product next month.', [c])).toEqual([]);
  });

  it('CASE B: a proposed tax is not an imposed tax', () => {
    const c = claim('b', 'The regulator proposed a 10% tax.', { temporal: 'proposed' });
    expect(rules('The regulator imposed a 10% tax.', [c])).toContain('proposal_to_implemented');
    expect(detectMeaningDrift('The regulator has proposed a 10% tax.', [c])).toEqual([]);
  });

  it('CASE C: year-over-year is not month-over-month', () => {
    const c = claim('c', 'Revenue increased 15% year over year.');
    expect(rules('Revenue increased 15% month over month.', [c])).toContain('period_changed');
    expect(detectMeaningDrift('Revenue grew 15% year-on-year.', [c])).toEqual([]);
  });

  it('CASE D: a reported loss is not cash lost', () => {
    const c = claim('d', 'The company reported a $2 billion loss.');
    expect(rules('The company lost $2 billion in cash.', [c])).toContain('accounting_loss_to_cash');
  });

  it('CASE E: "could reduce" said by a minister is not "will reduce"', () => {
    const c = claim('e', 'The minister said the policy could reduce inflation.', {
      type: 'ATTRIBUTION',
      temporal: 'possible',
      attributedTo: 'the minister',
    });
    const found = rules('The policy will reduce inflation.', [c]);
    expect(found).toContain('possibility_to_certainty');
    expect(found).toContain('attribution_dropped');
    expect(detectMeaningDrift('The minister said the policy could reduce inflation.', [c])).toEqual([]);
  });

  it('CASE F: "fell after earnings" is not "fell because earnings were bad"', () => {
    const c = claim('f', 'The stock fell 8% after earnings.');
    expect(rules('The stock fell because earnings were bad.', [c])).toContain('unsupported_causality');
  });

  it('CASE F (control): causal language is fine when a verified CAUSE claim supports it', () => {
    const c = claim('f', 'The stock fell 8% after earnings.');
    const cause = claim('f_cause', 'Analysts attributed the stock fall to weak earnings guidance.', { type: 'CAUSE' });
    expect(rules('The stock fell because of weak earnings guidance.', [c, cause])).not.toContain('unsupported_causality');
  });

  it('CASE G: first quarterly loss since 2020 is not "another quarterly loss"', () => {
    const c = claim('g', 'First quarterly loss since 2020.', { temporal: 'first_since' });
    expect(rules('Another quarterly loss for the company.', [c])).toContain('novelty_to_repetition');
  });

  it('CASE H: an association is not proof of causation', () => {
    const c = claim('h', 'The study found an association.');
    expect(rules('The study proved causation.', [c])).toContain('association_to_causation');
  });

  it('CASE I: a Reuters report must stay attributed', () => {
    const c = claim('i', 'According to Reuters, the company plans to cut 1,000 jobs.', {
      type: 'ATTRIBUTION',
      temporal: 'expected',
    });
    expect(rules('The company is cutting 1,000 jobs.', [c])).toContain('attribution_dropped');
    expect(detectMeaningDrift('According to Reuters, the company plans to cut 1,000 jobs.', [c])).toEqual([]);
  });
});

describe('detectMeaningDrift — attribution precision (found in a live run)', () => {
  const forecast = claim('fwd', 'The RBI has indicated that policy options going forward are largely between another rate hike and a pause.', {
    type: 'ATTRIBUTION',
    temporal: 'expected',
    entities: ['RBI'],
    attributedTo: 'Reserve Bank of India',
    mustPreserve: false,
  });

  it('does not flag a sentence about the hike itself just because it shares "RBI" and "rate" with an attributed forecast', () => {
    expect(rules('This is the first RBI repo rate hike since February 2023, and it could mean a bump in your EMI.', [forecast])).not.toContain(
      'attribution_dropped',
    );
  });

  it('still flags restating the attributed forecast without attribution', () => {
    expect(rules('Policy options going forward are largely between another rate hike and a pause.', [forecast])).toContain(
      'attribution_dropped',
    );
  });

  it('treats an acronym as naming the source (RBI = Reserve Bank of India)', () => {
    expect(
      rules('For the RBI, policy options going forward are largely between another hike and a pause.', [forecast]),
    ).not.toContain('attribution_dropped');
  });
});

describe('detectMeaningDrift — quotes and claim filtering', () => {
  it('flags a quotation that does not appear verbatim in any claim or evidence', () => {
    const c = claim('q', 'Governor said inflation risks remain elevated.', {
      type: 'QUOTE',
      evidence: [{ sourceId: 'source_1', quote: '"Inflation risks remain elevated," the Governor said.', quoteFound: true }],
    });
    expect(rules('The Governor warned "we will crush inflation at any cost" this week.', [c])).toContain('unverified_quote');
    expect(rules('The Governor said "inflation risks remain elevated" this week.', [c])).not.toContain('unverified_quote');
  });

  it('ignores unverified claims that are not mustPreserve', () => {
    const c = claim('u', 'This was the first RBI rate hike since 2023.', {
      verificationStatus: 'UNVERIFIED',
      mustPreserve: false,
      temporal: 'first_since',
    });
    expect(detectMeaningDrift('RBI hiked rates again.', [c])).toEqual([]);
  });

  it('does not anchor unrelated sentences to a claim', () => {
    const c = claim('x', 'This was the first RBI rate hike since 2023.', { entities: ['RBI'], temporal: 'first_since' });
    expect(detectMeaningDrift('Check your loan statement again next month.', [c])).toEqual([]);
  });
});
