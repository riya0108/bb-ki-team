import { z } from 'zod';

// The 9-state lifecycle from spec section 0.3.
export const ContentStatusSchema = z.enum([
  'idea',
  'researched',
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'rejected',
]);
export type ContentStatus = z.infer<typeof ContentStatusSchema>;

export const AgentModeSchema = z.enum([
  'source_discovery',
  'single_topic',
  'postcast_interview',
  'repurpose',
  'youtube_link',
  'voice_note',
  'edit',
  // X-specific (spec section 6.1) — single_topic/source_discovery/repurpose/edit
  // above are reused as-is since X's spec describes the same underlying concepts.
  'thread',
  'quote',
]);
export type AgentMode = z.infer<typeof AgentModeSchema>;

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ContentItemSchema = z.object({
  id: z.string().uuid(),
  platform: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdByAgent: z.string(),
  mode: AgentModeSchema,
  topic: z.string().nullable(),
  contentPillar: z.string().nullable(),
  sourceIds: z.array(z.string().uuid()).default([]),
  sourceUrls: z.array(z.string()).default([]),
  coreClaim: z.string().nullable(),
  angle: z.string().nullable(),
  contentDnaVersion: z.number().int().positive(),
  currentVersion: z.number().int().positive(),
  currentText: z.string(),
  status: ContentStatusSchema,
  riskLevel: RiskLevelSchema,
  approvedVersion: z.number().int().positive().nullable(),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().nullable(),
  // Full structured output contract for platforms whose content isn't one flat
  // string (X threads, Instagram carousels/reels, YouTube Shorts scripts) — see
  // spec section 23.1's PACKAGE field. currentText stays the single-string/primary
  // representation used for revisions/diffing regardless of platform; each agent
  // parses this back into its own typed *PackageSchema on read. null for platforms
  // (LinkedIn) whose currentText is already the complete output.
  package: z.record(z.string(), z.unknown()).nullable(),
});
export type ContentItem = z.infer<typeof ContentItemSchema>;

export const NewContentItemInputSchema = z.object({
  platform: z.string().default('linkedin'),
  createdByAgent: z.string(),
  mode: AgentModeSchema,
  topic: z.string().nullable().optional(),
  contentPillar: z.string().nullable().optional(),
  sourceIds: z.array(z.string().uuid()).optional(),
  sourceUrls: z.array(z.string()).optional(),
  coreClaim: z.string().nullable().optional(),
  angle: z.string().nullable().optional(),
  contentDnaVersion: z.number().int().positive(),
  text: z.string(),
  riskLevel: RiskLevelSchema.optional(),
  package: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type NewContentItemInput = z.infer<typeof NewContentItemInputSchema>;
