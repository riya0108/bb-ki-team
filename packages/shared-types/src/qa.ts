import { z } from 'zod';

export const QaOverallStatusSchema = z.enum(['PASS', 'PASS_WITH_WARNINGS', 'BLOCKED']);
export type QaOverallStatus = z.infer<typeof QaOverallStatusSchema>;

export const QaDimensionStatusSchema = z.enum(['PASS', 'WARN', 'FAIL']);
export type QaDimensionStatus = z.infer<typeof QaDimensionStatusSchema>;

export const QaDimensionResultSchema = z.object({
  status: QaDimensionStatusSchema,
  notes: z.string(),
  evidence: z.array(z.string()).optional(),
});
export type QaDimensionResult = z.infer<typeof QaDimensionResultSchema>;

// Fact/meaning QA dimensions added by the editorial-intelligence layer. Only present
// when a draft was written from a researched EditorialBrief — optional on QaResult so
// every QA row stored before this existed (and opinion-only drafts) still parses.
export const EditorialQaResultSchema = z.object({
  briefId: z.string(),
  claimCoverage: QaDimensionResultSchema,
  claimTraceability: QaDimensionResultSchema,
  meaningPreservation: QaDimensionResultSchema,
  temporalAccuracy: QaDimensionResultSchema,
  entityAccuracy: QaDimensionResultSchema,
  numberAccuracy: QaDimensionResultSchema,
  attributionAccuracy: QaDimensionResultSchema,
  causalityAccuracy: QaDimensionResultSchema,
  hookTraceability: QaDimensionResultSchema,
  crossPlatformConsistency: QaDimensionResultSchema,
});
export type EditorialQaResult = z.infer<typeof EditorialQaResultSchema>;

// Mirrors the Universal QA Gate dimension table and output contract (spec section 14).
export const QaResultSchema = z.object({
  overallStatus: QaOverallStatusSchema,
  claimIntegrity: QaDimensionResultSchema,
  sourceIntegrity: QaDimensionResultSchema,
  voiceMatch: QaDimensionResultSchema,
  originality: QaDimensionResultSchema,
  platformFit: QaDimensionResultSchema,
  clarity: QaDimensionResultSchema,
  hookHonesty: QaDimensionResultSchema,
  privacy: QaDimensionResultSchema,
  personalExperience: QaDimensionResultSchema,
  editability: QaDimensionResultSchema,
  approvalState: QaDimensionResultSchema,
  publishing: QaDimensionResultSchema,
  riskFlags: z.array(z.string()).default([]),
  requiredUserActions: z.array(z.string()).default([]),
  publishAllowed: z.boolean(),
  editorial: EditorialQaResultSchema.optional(),
  // Platform-specific gates (e.g. the Blog agent's editorial critic, AI-slop filter,
  // component-evidence and HTML checks). Folded into overallStatus exactly like the
  // core dimensions; optional so every stored QA row predating them still parses.
  platformChecks: z.record(z.string(), QaDimensionResultSchema).optional(),
});
export type QaResult = z.infer<typeof QaResultSchema>;
