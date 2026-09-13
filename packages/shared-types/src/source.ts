import { z } from 'zod';

export const SourceTierSchema = z.enum(['tier_1_primary', 'tier_2_secondary', 'tier_3_community']);
export type SourceTier = z.infer<typeof SourceTierSchema>;

export const SourceStatusSchema = z.enum(['active', 'inaccessible', 'removed', 'flagged']);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const SourceClaimSchema = z.object({
  text: z.string(),
  evidenceLink: z.string().url().optional(),
});
export type SourceClaim = z.infer<typeof SourceClaimSchema>;

export const SourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: z.string(),
  url: z.string().url(),
  author: z.string().nullable(),
  publishedAt: z.string().datetime().nullable(),
  accessedAt: z.string().datetime().nullable(),
  tier: SourceTierSchema,
  topics: z.array(z.string()).default([]),
  claims: z.array(SourceClaimSchema).default([]),
  evidenceLinks: z.array(z.string().url()).default([]),
  relevanceScore: z.number().min(0).max(1).nullable(),
  riskScore: z.number().min(0).max(1).nullable(),
  status: SourceStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Source = z.infer<typeof SourceSchema>;

export const NewSourceInputSchema = z.object({
  name: z.string(),
  platform: z.string(),
  url: z.string().url(),
  tier: SourceTierSchema.optional(),
  topics: z.array(z.string()).optional(),
});
export type NewSourceInput = z.infer<typeof NewSourceInputSchema>;
