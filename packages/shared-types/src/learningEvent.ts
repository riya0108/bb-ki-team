import { z } from 'zod';

export const LearningSourceSchema = z.enum([
  'user_instruction',
  'user_edit',
  'approval',
  'rejection',
  'performance',
]);
export type LearningSource = z.infer<typeof LearningSourceSchema>;

// Table from spec section 16.2.
export const LearningStrengthSchema = z.enum([
  'very_strong',
  'strong',
  'weak',
  'weak_until_explained',
  'not_a_voice_signal',
  'never',
]);
export type LearningStrength = z.infer<typeof LearningStrengthSchema>;

export const LearningEventSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  contentId: z.string().uuid().nullable(),
  source: LearningSourceSchema,
  observation: z.string(),
  strength: LearningStrengthSchema,
  confidence: z.number().min(0).max(1).nullable(),
  proposedChange: z.record(z.string(), z.unknown()).nullable(),
  confirmedByUser: z.boolean().nullable(),
  appliedToDna: z.boolean(),
  dnaVersion: z.number().int().positive().nullable(),
});
export type LearningEvent = z.infer<typeof LearningEventSchema>;

export const NewLearningEventInputSchema = z.object({
  contentId: z.string().uuid().nullable().optional(),
  source: LearningSourceSchema,
  observation: z.string(),
  strength: LearningStrengthSchema,
  confidence: z.number().min(0).max(1).nullable().optional(),
  proposedChange: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type NewLearningEventInput = z.infer<typeof NewLearningEventInputSchema>;
