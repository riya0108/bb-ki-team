import { z } from 'zod';

export const HookPatternSchema = z.enum([
  'surprisingFact',
  'personalConsequence',
  'unexpectedContrast',
  'firstOrLast',
  'scale',
  'tension',
  'whatThisMeansForYou',
  'curiosityGap',
  'counterintuitive',
  'consequenceFirst',
]);
export type HookPattern = z.infer<typeof HookPatternSchema>;

// Every hook must be traceable to the claims it rests on (spec: hook traceability).
export const HookCandidateSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  pattern: HookPatternSchema,
  supportingClaimIds: z.array(z.string()).min(1),
});
export type HookCandidate = z.infer<typeof HookCandidateSchema>;

// The LLM critic's judgement. factualAccuracy and meaningPreservation are hard
// gates — a hook failing either is rejected regardless of its other scores.
export const HookCritiqueSchema = z.object({
  hookId: z.string().min(1),
  factualAccuracy: z.boolean(),
  meaningPreservation: z.boolean(),
  specificity: z.number().min(0).max(10),
  curiosity: z.number().min(0).max(10),
  relevance: z.number().min(0).max(10),
  readerImpact: z.number().min(0).max(10),
  surprise: z.number().min(0).max(10),
  clarity: z.number().min(0).max(10),
  naturalness: z.number().min(0).max(10),
  brandFit: z.number().min(0).max(10),
  platformPotential: z.number().min(0).max(10),
  notes: z.string(),
});
export type HookCritique = z.infer<typeof HookCritiqueSchema>;

export const ScoredHookSchema = z.object({
  candidate: HookCandidateSchema,
  critique: HookCritiqueSchema.nullable(),
  rejected: z.boolean(),
  rejectionReasons: z.array(z.string()).default([]),
  score: z.number(),
});
export type ScoredHook = z.infer<typeof ScoredHookSchema>;
