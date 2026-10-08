import { z } from 'zod';

import {
  ClaimLedgerEntrySchema,
  CoverageCheckSchema,
  EditorialArchitectureSchema,
  EditorialQualitySchema,
  EditorialWarningSchema,
  InternalLinkSchema,
  SeoPlanSchema,
} from './blogEditorial.js';
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
  // Editorial upgrade (all additive, all defaulting so older callers keep parsing):
  // why the article is built the way it is, how the critic scored it, which
  // interactive components were used (and why others weren't), the verified claim
  // ledger it rests on, and anything the reviewer should look at first.
  editorialArchitecture: EditorialArchitectureSchema.nullable().default(null),
  editorialQuality: EditorialQualitySchema.nullable().default(null),
  interactiveComponents: z.array(z.string()).default([]),
  claimLedger: z.array(ClaimLedgerEntrySchema).default([]),
  internalLinks: z.array(InternalLinkSchema).default([]),
  seo: SeoPlanSchema.nullable().default(null),
  coverage: CoverageCheckSchema.nullable().default(null),
  editorialWarnings: z.array(EditorialWarningSchema).default([]),
});
export type BlogPackage = z.infer<typeof BlogPackageSchema>;
