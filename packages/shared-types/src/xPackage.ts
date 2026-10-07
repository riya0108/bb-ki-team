import { z } from 'zod';

import { ContentStatusSchema } from './contentItem.js';
import { EditorialSummarySchema } from './editorialBrief.js';
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
  // Up to 3 reach/engagement-boosting hashtags, already attached to finalCopy (and
  // threadPosts[0] when mode is 'thread') by packages/agents/x's appendHashtags —
  // kept here too so a reviewer/audit trail can see exactly which ones were chosen
  // without having to parse them back out of the post text.
  hashtags: z.array(z.string()).max(3).default([]),
  contentDnaVersion: z.number().int().positive(),
  // Phase 2 never publishes/schedules — always true / 'none', same as LinkedIn.
  approvalRequired: z.literal(true),
  publishAction: PublishActionSchema,
  // Additive, optional reference into visual_assets (packages/db/migrations/0018) —
  // see @bb/visual-agent. Defaults to null so every existing call to
  // XPackageSchema.parse(...) keeps working unchanged (BB-Visual-Agent-Skill's
  // integration contract: "keep visual data additive").
  visualAssetId: z.string().uuid().nullable().default(null),
  // The verified editorial core this draft was written from (story, angle, key facts,
  // uncertain claims, chosen hook) — surfaced for human review. null for drafts not
  // produced through the editorial-intelligence pipeline (repurpose/quote/edit flows).
  editorialSummary: EditorialSummarySchema.nullable().default(null),
});
export type XPackage = z.infer<typeof XPackageSchema>;
