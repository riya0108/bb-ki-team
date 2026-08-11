import { z } from 'zod';

export const ApprovalDecisionSchema = z.enum(['approved', 'changes_requested']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalGateSchema = z.enum(['topic', 'draft']);
export type ApprovalGate = z.infer<typeof ApprovalGateSchema>;

/** A recorded human decision at an approval gate — the auditable "why was this selected" trail (plan §35). */
export const ApprovalSchema = z.object({
  id: z.string().min(1),
  workflowRunId: z.string().min(1),
  gate: ApprovalGateSchema,
  decision: ApprovalDecisionSchema,
  selection: z.unknown().nullable(),
  feedback: z.string().nullable(),
  decidedAt: z.string(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

/** Body of POST /workflows/:runId/approve. */
export const ApprovalRequestSchema = z.object({
  decision: ApprovalDecisionSchema,
  selection: z.unknown().optional(),
  feedback: z.string().min(1).optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

/** `selection` shape for the "topic" gate specifically — which of the Topic Finder's candidates was picked. */
export const TopicSelectionSchema = z.object({
  selectedTopicIndex: z.number().int().min(0),
  modificationNote: z.string().min(1).optional(),
});
export type TopicSelection = z.infer<typeof TopicSelectionSchema>;
