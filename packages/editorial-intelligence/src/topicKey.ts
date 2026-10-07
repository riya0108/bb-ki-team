import { contentStems } from '@bb/qa-gate';

// A normalized, order-independent key for "the same story": "RBI hikes rates for the
// first time since 2023" and "First RBI rate hike since 2023" share one brief.
export function normalizeTopicKey(topic: string): string {
  return [...new Set(contentStems(topic))].sort().join(' ');
}
