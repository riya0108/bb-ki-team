import type { QaDimensionResult } from '@bb/shared-types';

// Matches numeric claims worth sourcing: percentages, currency amounts, and bare
// numbers of 2+ digits (to skip small ordinary counts like "3 tips").
// Digits glued to a letter are labels, not figures ("FY23", "Q4", "H1"), and a decade
// ("the 1970s") is a period, not a statistic.
const NUMBER_CLAIM_PATTERN = /(₹|\$|Rs\.?\s?)?(?<![A-Za-z\d])\d[\d,]*(\.\d+)?(?!\d*s\b)\s?%?/g;
const MIN_DIGIT_LENGTH = 2;

// A worked example labelled as one ("Illustratively...", "Assume...", "Picture a
// 27-year-old...") may use its own round inputs. The labelled paragraph and up to
// ILLUSTRATION_SPAN short follow-on paragraphs (the step-by-step arithmetic) are exempt.
const ILLUSTRATION_MARKER = /\b(illustrative(ly)?|for illustration|hypothetical(ly)?|assume|assuming|suppose|imagine|picture|say you|let's say|made-up|worked example)\b/i;
const ILLUSTRATION_SPAN = 3;
const SHORT_PARAGRAPH_WORDS = 60;

export function withoutIllustrations(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  const kept: string[] = [];
  let remaining = 0;
  for (const p of paragraphs) {
    if (ILLUSTRATION_MARKER.test(p)) {
      remaining = ILLUSTRATION_SPAN;
      continue;
    }
    if (remaining > 0 && p.split(/\s+/).length <= SHORT_PARAGRAPH_WORDS) {
      remaining -= 1;
      continue;
    }
    remaining = 0;
    kept.push(p);
  }
  return kept.join('\n\n');
}

function extractNumberClaims(text: string): string[] {
  const matches = withoutIllustrations(text).match(NUMBER_CLAIM_PATTERN) ?? [];
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
