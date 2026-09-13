import { z } from 'zod';

import { ContentStatusSchema } from './contentItem.js';
import { PublishActionSchema } from './publishAction.js';

// spec section 6.4's `mode: single | thread | quote`. Distinct from AgentModeSchema
// (which tracks *how the idea originated* — source_discovery, single_topic, repurpose,
// etc. — reused as-is for X per spec 6.1): this tracks the shape of the final output.
export const XModeSchema = z.enum(['single', 'thread', 'quote']);
export type XMode = z.infer<typeof XModeSchema>;

// Mirrors the X_PACKAGE output contract, spec section 6.4.
export const XPackageSchema = z.object({
  contentId: z.string().uuid(),
  status: ContentStatusSchema,
  mode: XModeSchema,
  topic: z.string().nullable(),
  angle: z.string().nullable(),
  hookOptions: z.array(z.string()).default([]),
  finalCopy: z.string(),
  // Non-null only when mode === 'thread'; finalCopy still carries the first post so
  // every mode has one consistent "the primary text" field.
  threadPosts: z.array(z.string()).nullable(),
  sourceReferences: z.array(z.string()).default([]),
  factCheckStatus: z.string(),
  contentDnaVersion: z.number().int().positive(),
  // Phase 2 never publishes/schedules — always true / 'none', same as LinkedIn.
  approvalRequired: z.literal(true),
  publishAction: PublishActionSchema,
});
export type XPackage = z.infer<typeof XPackageSchema>;
