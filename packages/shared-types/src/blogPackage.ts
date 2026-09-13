import { z } from 'zod';

import { ContentStatusSchema } from './contentItem.js';
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
});
export type BlogPackage = z.infer<typeof BlogPackageSchema>;
