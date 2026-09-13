import { z } from 'zod';

export const ChangeTypeSchema = z.enum([
  'ai_draft',
  'ai_regeneration',
  'user_edit',
  'interview_answer',
  'angle_selection',
  'system_reset',
]);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

export const ChangedByTypeSchema = z.enum(['user', 'agent', 'system']);
export type ChangedByType = z.infer<typeof ChangedByTypeSchema>;

export const RevisionSchema = z.object({
  id: z.string().uuid(),
  contentId: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  changeType: ChangeTypeSchema,
  previousText: z.string().nullable(),
  newText: z.string(),
  changedBy: ChangedByTypeSchema,
  changedById: z.string().nullable(),
  reason: z.string().nullable(),
  approvalInvalidated: z.boolean(),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const NewRevisionInputSchema = z.object({
  changeType: ChangeTypeSchema,
  newText: z.string(),
  changedBy: ChangedByTypeSchema,
  changedById: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});
export type NewRevisionInput = z.infer<typeof NewRevisionInputSchema>;
