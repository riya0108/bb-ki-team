import type { QaDimensionResult } from '@bb/shared-types';

// Matches numeric claims worth sourcing: percentages, currency amounts, and bare
// numbers of 2+ digits (to skip small ordinary counts like "3 tips").
const NUMBER_CLAIM_PATTERN = /(₹|\$|Rs\.?\s?)?\d[\d,]*(\.\d+)?\s?%?/g;
const MIN_DIGIT_LENGTH = 2;

function extractNumberClaims(text: string): string[] {
  const matches = text.match(NUMBER_CLAIM_PATTERN) ?? [];
  return matches.filter((m) => m.replace(/[^0-9]/g, '').length >= MIN_DIGIT_LENGTH);
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
  const unsupported = claims.filter((claim) => !combinedSources.includes(claim.toLowerCase().trim()));

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
