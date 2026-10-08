import { z } from 'zod';

import { RiskLevelSchema } from './contentItem.js';

export const EmotionalModeSchema = z.enum([
  'curiosity',
  'surprise',
  'urgency',
  'concern',
  'skepticism',
  'contrast',
  'intrigue',
  'personalConsequence',
  'opportunity',
  'awe',
]);
export type EmotionalMode = z.infer<typeof EmotionalModeSchema>;

export const EditorialAngleSchema = z.object({
  id: z.string().min(1),
  angle: z.string().min(1),
  rationale: z.string().min(1),
  supportingClaimIds: z.array(z.string()).min(1),
  audience: z.string().min(1),
  emotionalMode: EmotionalModeSchema,
  riskLevel: RiskLevelSchema,
  // 0-10 model-assessed sub-scores the deterministic selector weighs. Evidence
  // strength is NOT one of them — selectAngle computes that from the claim ledger.
  relevance: z.number().min(0).max(10),
  novelty: z.number().min(0).max(10),
  readerImpact: z.number().min(0).max(10),
  curiosity: z.number().min(0).max(10),
  brandFit: z.number().min(0).max(10),
  // Whether this angle is what the user explicitly asked for (an angle request /
  // editorial intent in their message).
  matchesUserIntent: z.boolean().default(false),
});
export type EditorialAngle = z.infer<typeof EditorialAngleSchema>;

export const RankedFactSchema = z.object({
  claimId: z.string().min(1),
  importance: z.number().int().min(1).max(10),
  reason: z.string(),
});
export type RankedFact = z.infer<typeof RankedFactSchema>;

// The bridge between research and writing: what the story *is*, derived only from
// verified claims. Every field is prose about claims in the ledger, never new facts.
export const StoryEssenceSchema = z.object({
  event: z.string().min(1),
  whatChanged: z.string().min(1),
  novelty: z.string().nullable(),
  significance: z.string().min(1),
  mostImportantFactClaimId: z.string().min(1),
  mostInterestingFactClaimId: z.string().min(1),
  affectedAudience: z.array(z.string()).default([]),
  immediateConsequence: z.string().nullable(),
  longerTermImplication: z.string().nullable(),
  readerImpact: z.string().nullable(),
  businessImpact: z.string().nullable(),
  economicImpact: z.string().nullable(),
  hiddenMechanism: z.string().nullable(),
  surpriseElement: z.string().nullable(),
  tension: z.string().nullable(),
  whyItMatters: z.string().min(1),
  rankedFacts: z.array(RankedFactSchema).default([]),
  editorialAngles: z.array(EditorialAngleSchema).default([]),
  recommendedAngleId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  // Contradiction engine: usable claims that cut AGAINST the obvious reading / the
  // recommended angle, the strongest counterargument they support, and what the
  // evidence cannot tell us. Defaults keep older stored essences parsing.
  counterEvidenceClaimIds: z.array(z.string()).default([]),
  strongestCounterargument: z.string().nullable().default(null),
  commonExplanation: z.string().nullable().default(null),
  whatDataDoesNotShow: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  whatToWatch: z.array(z.string()).default([]),
});
export type StoryEssence = z.infer<typeof StoryEssenceSchema>;
