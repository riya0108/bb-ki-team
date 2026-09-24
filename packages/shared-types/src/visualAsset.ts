import { z } from 'zod';

// Mirrors BB-Visual-Agent-Skill's visual-asset.schema.json status enum. Additive to
// the existing 9-state ContentStatus lifecycle (contentItem.ts) — a visual asset has
// its own lifecycle because one content item's text can be approved while its visual
// is still mid-generation/QA, or vice versa (spec: "any post-approval visual change
// invalidates approval for the affected package").
export const VisualStatusSchema = z.enum([
  'NOT_REQUIRED',
  'BRIEF_READY',
  'GENERATION_PENDING',
  'GENERATED',
  'QA_PASS',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
  'FAILED',
]);
export type VisualStatus = z.infer<typeof VisualStatusSchema>;

export const VisualDecisionSchema = z.enum([
  'REQUIRED',
  'RECOMMENDED',
  'OPTIONAL',
  'NOT_APPROPRIATE',
  'REAL_ASSET_REQUIRED',
]);
export type VisualDecision = z.infer<typeof VisualDecisionSchema>;

export const VisualTypeSchema = z.enum([
  'editorial_photo',
  'product_photo',
  'illustration',
  'infographic',
  'diagram',
  'data_visual',
  'conceptual',
  'sourced_asset',
  'thumbnail',
]);
export type VisualType = z.infer<typeof VisualTypeSchema>;

// ai_generated is the only mode this pass actually implements (see @bb/visual-agent);
// the other three are modeled now so a human-supplied or sourced asset can be
// recorded later without a schema change.
export const VisualSourceModeSchema = z.enum([
  'ai_generated',
  'real_sourced_asset',
  'user_supplied_asset',
  'hybrid',
]);
export type VisualSourceMode = z.infer<typeof VisualSourceModeSchema>;

export const VisualClaimTypeSchema = z.enum([
  'verified_fact',
  'attributed_claim',
  'interpretation',
  'opinion',
  'prediction',
  'illustrative',
]);
export type VisualClaimType = z.infer<typeof VisualClaimTypeSchema>;

export const VisualClaimSchema = z.object({
  claim: z.string(),
  claimType: VisualClaimTypeSchema,
  sourceIds: z.array(z.string()).default([]),
});
export type VisualClaim = z.infer<typeof VisualClaimSchema>;

export const GenerationBriefSchema = z.object({
  subject: z.string(),
  secondarySubjects: z.array(z.string()).default([]),
  action: z.string(),
  environment: z.string(),
  emotion: z.string().nullable(),
  composition: z.string(),
  camera: z.string(),
  lens: z.string().nullable(),
  lighting: z.string(),
  depthOfField: z.string().nullable(),
  style: z.string(),
  aspectRatio: z.string(),
  textOnImage: z.string(),
  negativeConstraints: z.array(z.string()).default([]),
});
export type GenerationBrief = z.infer<typeof GenerationBriefSchema>;

export const VisualQaStatusSchema = z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW']);
export type VisualQaStatus = z.infer<typeof VisualQaStatusSchema>;

// Deliberately no automated PASS for visualQuality: the existing LlmClient
// (@bb/core) sends text-only messages, so nothing in this codebase can actually
// inspect the generated pixels (hands/faces/artifacts per the skill's
// visual-qa.md). visualQuality is always NEEDS_REVIEW pending a human look at the
// asset; the other dimensions are judged from the brief/claims text, which the LLM
// can genuinely evaluate.
export const VisualQaSchema = z.object({
  status: VisualQaStatusSchema,
  truthIntegrity: VisualQaStatusSchema,
  evidenceIntegrity: VisualQaStatusSchema,
  identityPrivacy: VisualQaStatusSchema,
  visualQuality: VisualQaStatusSchema,
  editorialFit: VisualQaStatusSchema,
  platformFit: VisualQaStatusSchema,
  issues: z.array(z.string()).default([]),
  requiredFixes: z.array(z.string()).default([]),
  reviewerNotes: z.string(),
});
export type VisualQa = z.infer<typeof VisualQaSchema>;

export const MasterAssetStatusSchema = z.enum(['NONE', 'STORED', 'FAILED']);
export type MasterAssetStatus = z.infer<typeof MasterAssetStatusSchema>;

export const MasterAssetSchema = z.object({
  status: MasterAssetStatusSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  generationId: z.string().nullable(),
  assetPath: z.string().nullable(),
  assetUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: z.string().datetime().nullable(),
});
export type MasterAsset = z.infer<typeof MasterAssetSchema>;

export const PlatformVariantSchema = z.object({
  assetPath: z.string().nullable(),
  assetUrl: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  cropNotes: z.string().nullable(),
  status: z.string(),
});
export type PlatformVariant = z.infer<typeof PlatformVariantSchema>;

// Mirrors BB-Visual-Agent-Skill's visual-asset.schema.json, adapted to this repo's
// camelCase Zod convention. One row per (contentId, version) — see
// packages/db/migrations/0018_visual_assets.sql and
// packages/db/src/repositories/visualAssets.ts — so a text edit that bumps
// currentVersion naturally gets its own visual row instead of overwriting history.
export const VisualAssetSchema = z.object({
  id: z.string().uuid(),
  contentId: z.string().uuid(),
  version: z.number().int().positive(),
  status: VisualStatusSchema,
  visualDecision: VisualDecisionSchema.nullable(),
  visualType: VisualTypeSchema.nullable(),
  concept: z.string().nullable(),
  rationale: z.string().nullable(),
  sourceMode: VisualSourceModeSchema.nullable(),
  isAiGenerated: z.boolean(),
  isIllustrative: z.boolean(),
  disclosureRequired: z.boolean(),
  generationBrief: GenerationBriefSchema.nullable(),
  visualClaims: z.array(VisualClaimSchema).default([]),
  fictionalOrIllustrativeElements: z.array(z.string()).default([]),
  riskFlags: z.array(z.string()).default([]),
  qa: VisualQaSchema.nullable(),
  masterAsset: MasterAssetSchema,
  platformVariants: z.record(z.string(), PlatformVariantSchema).default({}),
  blockingReasons: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VisualAsset = z.infer<typeof VisualAssetSchema>;
