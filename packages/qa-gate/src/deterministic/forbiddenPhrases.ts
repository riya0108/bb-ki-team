import { FORBIDDEN_PHRASES } from '@bb/core';
import type { QaDimensionResult } from '@bb/shared-types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Spec section 2.3 (brand-wide list) + Content DNA's own voice.forbiddenPhrases —
// callers should pass both in.
export function checkForbiddenPhrases(text: string, extraForbidden: readonly string[] = []): QaDimensionResult {
  const all = [...FORBIDDEN_PHRASES, ...extraForbidden];
  const hits: string[] = [];
  for (const phrase of all) {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'i');
    if (pattern.test(text)) hits.push(phrase);
  }

  if (hits.length === 0) {
    return { status: 'PASS', notes: 'No forbidden phrases found.' };
  }
  return {
    status: 'FAIL',
    notes: `Found forbidden phrase(s): ${hits.join(', ')}.`,
    evidence: hits,
  };
}
