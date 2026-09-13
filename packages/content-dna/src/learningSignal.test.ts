import { describe, expect, it } from 'vitest';

import { classifyLearningSignal } from './learningSignal.js';

describe('classifyLearningSignal (spec section 16.2)', () => {
  it('explicit_instruction -> very_strong', () => {
    expect(classifyLearningSignal({ kind: 'explicit_instruction', text: 'never use em dashes' })).toBe(
      'very_strong',
    );
  });

  it('user_edit (repeated) -> strong', () => {
    expect(classifyLearningSignal({ kind: 'user_edit', diffSummary: 'shortened hooks', isRepeated: true })).toBe(
      'strong',
    );
  });

  it('user_edit (one-off) -> weak', () => {
    expect(classifyLearningSignal({ kind: 'user_edit', diffSummary: 'fixed a typo', isRepeated: false })).toBe(
      'weak',
    );
  });

  it('repeated_approval_pattern -> strong', () => {
    expect(classifyLearningSignal({ kind: 'repeated_approval_pattern', pattern: 'question-based hooks' })).toBe(
      'strong',
    );
  });

  it('one_off_edit -> weak', () => {
    expect(classifyLearningSignal({ kind: 'one_off_edit' })).toBe('weak');
  });

  it('viral_post (unexplained) -> weak_until_explained', () => {
    expect(classifyLearningSignal({ kind: 'viral_post', explained: false })).toBe('weak_until_explained');
  });

  // Judgment call: spec 16.2's table lists "one viral post -> weak until explained" as
  // a single row with no explicit "explained" branch. Section 16.3 says a
  // high-performing hook "should be analysed for the reason it worked before it
  // becomes a reusable pattern" — read together, once a viral post's mechanism has
  // actually been analysed and explained, it becomes as actionable as a repeated
  // approval pattern, so this classifier promotes it to 'strong' rather than leaving
  // it stuck at 'weak_until_explained' forever.
  it('viral_post (explained) -> strong', () => {
    expect(classifyLearningSignal({ kind: 'viral_post', explained: true })).toBe('strong');
  });

  it('competitor_viral_post -> not_a_voice_signal', () => {
    expect(classifyLearningSignal({ kind: 'competitor_viral_post' })).toBe('not_a_voice_signal');
  });

  it("model_own_preference -> never", () => {
    expect(classifyLearningSignal({ kind: 'model_own_preference' })).toBe('never');
  });
});
