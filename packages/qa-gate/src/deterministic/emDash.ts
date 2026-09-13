import type { QaDimensionResult } from '@bb/shared-types';

const EM_DASH_PATTERN = /—|--/g;

// Spec section 2.3: "No em dashes in final copy. Use commas, colons, periods or line breaks."
export function checkEmDash(text: string): QaDimensionResult {
  const matches = text.match(EM_DASH_PATTERN);
  if (!matches || matches.length === 0) {
    return { status: 'PASS', notes: 'No em dashes or double hyphens found.' };
  }
  return {
    status: 'FAIL',
    notes: `Found ${matches.length} em dash / double hyphen occurrence(s). Use commas, colons, periods or line breaks instead.`,
    evidence: matches,
  };
}
