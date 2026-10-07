import { z } from 'zod';

import { ContentStatusSchema } from './contentItem.js';
import { EditorialSummarySchema } from './editorialBrief.js';
import { PublishActionSchema } from './publishAction.js';

// Mirrors the BLOG_PACKAGE output contract, spec section 12.6.
export const BlogPackageSchema = z.object({
  contentId: z.string().uuid(),
  status: ContentStatusSchema,
  title: z.string(),
  slug: z.string(),
  category: z.string(),
  metaDescription: z.string(),
  deck: z.string(),
  estimatedReadTime: z.string().nullable(),
  sources: z.array(z.string()).default([]),
  articleSummary: z.string(),
  htmlFile: z.string(),
  qaStatus: z.string(),
  factCheckStatus: z.string(),
  seoStatus: z.string(),
  styleMatchStatus: z.string(),
  contentDnaVersion: z.number().int().positive(),
  approvalRequired: z.literal(true),
  publishAction: PublishActionSchema,
  // Additive, optional reference into visual_assets (packages/db/migrations/0018) —
  // see @bb/visual-agent. Defaults to null so every existing call to
  // BlogPackageSchema.parse(...) keeps working unchanged (BB-Visual-Agent-Skill's
  // integration contract: "keep visual data additive").
  visualAssetId: z.string().uuid().nullable().default(null),
  // The verified editorial core this draft was written from (story, angle, key facts,
  // uncertain claims, chosen hook) — surfaced for human review. null for drafts not
  // produced through the editorial-intelligence pipeline (repurpose/quote/edit flows).
  editorialSummary: EditorialSummarySchema.nullable().default(null),
});
export type BlogPackage = z.infer<typeof BlogPackageSchema>;
