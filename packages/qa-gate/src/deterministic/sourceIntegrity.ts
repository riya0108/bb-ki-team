import type { QaDimensionResult } from '@bb/shared-types';

const CLAIM_LIKE_PATTERN = /\d[\d,]*(\.\d+)?\s?%?|\baccording to\b|\bstudy (shows|found)\b|\breport(ed|s)?\b/i;

// Spec section 14: "Source integrity — Important claims can be traced."
export function checkSourceIntegrity(text: string, sourceReferences: readonly string[]): QaDimensionResult {
  if (sourceReferences.length > 0) {
    return { status: 'PASS', notes: `${sourceReferences.length} source reference(s) attached.` };
  }

  if (CLAIM_LIKE_PATTERN.test(text)) {
    return {
      status: 'FAIL',
      notes: 'Draft contains claim-like statements (numbers, "according to", "study shows"/"reported") but no source references are attached.',
    };
  }

  return { status: 'PASS', notes: 'No claim-like statements requiring a traceable source were found.' };
}
