import type { LearningStrength } from '@bb/shared-types';

// Discriminated union covering the learning signals named in spec section 16.1.
export type RawSignal =
  | { kind: 'explicit_instruction'; text: string }
  | { kind: 'user_edit'; diffSummary: string; isRepeated: boolean }
  | { kind: 'repeated_approval_pattern'; pattern: string }
  | { kind: 'one_off_edit' }
  | { kind: 'viral_post'; explained: boolean }
  | { kind: 'competitor_viral_post' }
  | { kind: 'model_own_preference' };

// Pure, table-driven exactly per spec section 16.2 ("Strong vs weak learning").
export function classifyLearningSignal(signal: RawSignal): LearningStrength {
  switch (signal.kind) {
    case 'explicit_instruction':
      return 'very_strong';
    case 'user_edit':
      return signal.isRepeated ? 'strong' : 'weak';
    case 'repeated_approval_pattern':
      return 'strong';
    case 'one_off_edit':
      return 'weak';
    case 'viral_post':
      return signal.explained ? 'strong' : 'weak_until_explained';
    case 'competitor_viral_post':
      return 'not_a_voice_signal';
    case 'model_own_preference':
      return 'never';
  }
}
