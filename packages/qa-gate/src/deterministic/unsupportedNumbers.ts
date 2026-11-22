import type { QaDimensionResult } from '@bb/shared-types';

import { illustrationRanges } from '../editorial/illustrations.js';
import { extractQuantities, quantitiesMatch } from '../editorial/quantities.js';

// Matches numeric claims worth sourcing: percentages, currency amounts, and bare
// numbers of 2+ digits (to skip small ordinary counts like "3 tips").
// Digits glued to a letter are labels, not figures ("FY23", "Q4", "H1"), and a decade
// ("the 1970s") is a period, not a statistic.
const NUMBER_CLAIM_PATTERN = /(₹|\$|Rs\.?\s?)?(?<![A-Za-z\d])\d[\d,]*(\.\d+)?(?!\d*s\b)\s?%?/g;
const MIN_DIGIT_LENGTH = 2;

// A worked example labelled as one ("Illustratively...", "Assume...", "Picture a
// 27-year-old...") may use its own round inputs and arithmetic, so its span is exempt.
export function withoutIllustrations(text: string): string {
  let kept = '';
  let cursor = 0;
  for (const r of illustrationRanges(text)) {
    kept += text.slice(cursor, r.start);
    cursor = r.end;
  }
  return kept + text.slice(cursor);
}

function extractNumberClaims(text: string): string[] {
  const matches = withoutIllustrations(text).match(NUMBER_CLAIM_PATTERN) ?? [];
  // The pattern's digit run can swallow a trailing list comma ("₹5,00,000, principal").
  return matches.map((m) => m.replace(/[,\s]+$/, '')).filter((m) => m.replace(/[^0-9]/g, '').length >= MIN_DIGIT_LENGTH);
}

// Spec section 14.1/14.2: unsourced statistics are high-risk; the agent must not
// "fill in the blank" with a plausible-looking fact. This is a heuristic, not proof —
// it flags numbers absent from any supplied source text so a human/LLM rubric can
// look closer, rather than silently trusting the draft.
export function checkUnsupportedNumbers(
  text: string,
  sourceTexts: readonly string[],
  isHighRiskTopic: boolean,
): QaDimensionResult {
  const claims = extractNumberClaims(text);
  if (claims.length === 0) {
    return { status: 'PASS', notes: 'No numeric claims found.' };
  }

  const combinedSources = sourceTexts.join('\n').toLowerCase();
  // "₹5,00,000" is supported by a source's "Rs 5 lakh" or "500000": compare by value
  // and unit too, not only by spelling.
  const sourceQuantities = extractQuantities(combinedSources);
  const unsupported = claims.filter((claim) => {
    if (combinedSources.includes(claim.toLowerCase().trim())) return false;
    const [q] = extractQuantities(claim);
    return !q || !sourceQuantities.some((s) => quantitiesMatch(s, q));
  });

  if (unsupported.length === 0) {
    return { status: 'PASS', notes: 'All numeric claims appear in supplied source text.' };
  }

  if (sourceTexts.length === 0) {
    return {
      status: isHighRiskTopic ? 'FAIL' : 'WARN',
      notes: `${unsupported.length} numeric claim(s) with no source material supplied to verify against.`,
      evidence: unsupported,
    };
  }

  return {
    status: isHighRiskTopic ? 'FAIL' : 'WARN',
    notes: `${unsupported.length} numeric claim(s) not found in supplied source text.`,
    evidence: unsupported,
  };
}
