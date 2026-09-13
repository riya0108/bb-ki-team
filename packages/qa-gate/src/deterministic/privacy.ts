import type { QaDimensionResult } from '@bb/shared-types';

const CLIENT_INFO_PATTERN = /\b(client (name|data|confidential)|non-disclosure|NDA)\b/i;

// Spec section 14: "Privacy — No unauthorised private/client information."
export function checkPrivacy(text: string, sensitiveOrPrivate: readonly string[]): QaDimensionResult {
  const lower = text.toLowerCase();
  const hit = sensitiveOrPrivate.find((entry) => entry.trim().length > 0 && lower.includes(entry.toLowerCase()));
  if (hit) {
    return {
      status: 'FAIL',
      notes: 'Draft includes a phrase marked sensitive_or_private in Content DNA.',
      evidence: [hit],
    };
  }

  if (CLIENT_INFO_PATTERN.test(text)) {
    return {
      status: 'WARN',
      notes: 'Draft references client/confidential information language — verify this is authorized for publication.',
    };
  }

  return { status: 'PASS', notes: 'No sensitive/private or client-confidential information detected.' };
}
