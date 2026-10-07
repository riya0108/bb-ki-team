import { z } from 'zod';

import { AgentModeSchema, ContentStatusSchema } from './contentItem.js';
import { EditorialSummarySchema } from './editorialBrief.js';
import { PublishActionSchema } from './publishAction.js';

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
  // The verified editorial core this draft was written from (story, angle, key facts,
  // uncertain claims, chosen hook) — surfaced for human review. null for drafts not
  // produced through the editorial-intelligence pipeline (repurpose/quote/edit flows).
  editorialSummary: EditorialSummarySchema.nullable().default(null),
});
export type LinkedinPackage = z.infer<typeof LinkedinPackageSchema>;
