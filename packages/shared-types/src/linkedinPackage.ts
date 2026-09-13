import { z } from 'zod';

import { AgentModeSchema, ContentStatusSchema } from './contentItem.js';

export const PublishActionSchema = z.enum(['none', 'schedule', 'publish']);
export type PublishAction = z.infer<typeof PublishActionSchema>;

// Mirrors the LINKEDIN_PACKAGE output contract, spec section 5.7.
export const LinkedinPackageSchema = z.object({
  contentId: z.string().uuid(),
  status: ContentStatusSchema,
  mode: AgentModeSchema,
  topic: z.string().nullable(),
  sourceReferences: z.array(z.string()).default([]),
  angle: z.string().nullable(),
  hookOptions: z.array(z.string()).default([]),
  finalPost: z.string(),
  characterCount: z.number().int().nonnegative(),
  contentDnaVersion: z.number().int().positive(),
  factCheckStatus: z.string(),
  originalityStatus: z.string(),
  riskFlags: z.array(z.string()).default([]),
  visualSuggestion: z.string().nullable(),
  firstCommentOptional: z.string().nullable(),
  // Phase 1 never publishes/schedules — this is always true and publishAction is always 'none'.
  approvalRequired: z.literal(true),
  publishAction: PublishActionSchema,
  scheduleDetails: z.string().nullable(),
});
export type LinkedinPackage = z.infer<typeof LinkedinPackageSchema>;
