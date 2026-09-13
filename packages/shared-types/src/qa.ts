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
});
export type QaResult = z.infer<typeof QaResultSchema>;
