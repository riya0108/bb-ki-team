import { z } from 'zod';

import { ClaimSchema, EvidenceSourceSchema } from './claim.js';
import { RiskLevelSchema } from './contentItem.js';
import { HookCandidateSchema, ScoredHookSchema } from './hook.js';
import { EditorialAngleSchema, EmotionalModeSchema, StoryEssenceSchema } from './storyEssence.js';

// Spec sections 34/35: a user's message mixes facts with editorial intent, style
// requests, angle requests and hook suggestions. Only `candidateFacts` are ever
// treated as claims (and then only after verification) — the rest is direction,
// never evidence.
export const UserRequestAnalysisSchema = z.object({
  candidateFacts: z.array(z.string()).default([]),
  editorialIntent: z.array(z.string()).default([]),
  styleRequests: z.array(z.string()).default([]),
  angleRequests: z.array(z.string()).default([]),
  hookSuggestions: z.array(z.string()).default([]),
});
export type UserRequestAnalysis = z.infer<typeof UserRequestAnalysisSchema>;

// researched: claims were extracted from gathered evidence.
// insufficient_evidence: the topic needed research but none could be gathered —
//   writers must not state unverified facts, and QA treats every factual statement
//   as untraceable.
// opinion: evergreen/opinion request where external research was unnecessary.
export const EditorialBriefKindSchema = z.enum(['researched', 'insufficient_evidence', 'opinion']);
export type EditorialBriefKind = z.infer<typeof EditorialBriefKindSchema>;

export const ResearchSummarySchema = z.object({
  queries: z.array(z.string()).default([]),
  documentsConsidered: z.number().int().nonnegative(),
  documentsUsed: z.number().int().nonnegative(),
  failures: z.array(z.object({ url: z.string(), reason: z.string() })).default([]),
});
export type ResearchSummary = z.infer<typeof ResearchSummarySchema>;

export const EDITORIAL_BRIEF_SCHEMA_VERSION = 1;

// The single verified editorial core every platform writer receives (spec 20). X,
// LinkedIn and Blog may differ in length/structure/tone, never in the facts here.
export const EditorialBriefSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(EDITORIAL_BRIEF_SCHEMA_VERSION),
  createdAt: z.string().datetime(),
  runId: z.string(),
  topic: z.string().min(1),
  // Normalized topic used to reuse one brief across platforms (cost control + one
  // shared factual core) instead of researching the same story three times.
  topicKey: z.string(),
  kind: EditorialBriefKindSchema,
  riskLevel: RiskLevelSchema,
  riskFlags: z.array(z.string()).default([]),
  userRequest: UserRequestAnalysisSchema,
  research: ResearchSummarySchema,
  sources: z.array(EvidenceSourceSchema).default([]),
  claims: z.array(ClaimSchema).default([]),
  storyEssence: StoryEssenceSchema.nullable(),
  selectedAngle: EditorialAngleSchema.nullable(),
  hookCandidates: z.array(ScoredHookSchema).default([]),
  selectedHooks: z.array(HookCandidateSchema).default([]),
  audience: z.string().nullable(),
  emotionalMode: EmotionalModeSchema.nullable(),
  keyFactClaimIds: z.array(z.string()).default([]),
  protectedClaimIds: z.array(z.string()).default([]),
  thingsNotToSay: z.array(z.string()).default([]),
  uncertaintyNotes: z.array(z.string()).default([]),
  temporalNotes: z.array(z.string()).default([]),
  contentDnaVersion: z.number().int().positive(),
  brandBrainVersion: z.string(),
  promptVersion: z.string(),
});
export type EditorialBrief = z.infer<typeof EditorialBriefSchema>;

// Compact human-review view of a brief, attached to each platform package (spec 50:
// make review better by exposing what the story is, why this angle, which facts
// support it, what is uncertain, why the hook was chosen).
export const EditorialSummarySchema = z.object({
  briefId: z.string().uuid(),
  kind: EditorialBriefKindSchema,
  story: z.string().nullable(),
  whyItMatters: z.string().nullable(),
  selectedAngle: z.string().nullable(),
  angleRationale: z.string().nullable(),
  selectedHook: z.string().nullable(),
  keyFacts: z.array(z.object({ claimId: z.string(), text: z.string(), status: z.string() })).default([]),
  uncertainClaims: z.array(z.object({ claimId: z.string(), text: z.string(), status: z.string() })).default([]),
  sourceReferences: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type EditorialSummary = z.infer<typeof EditorialSummarySchema>;
