import { z } from 'zod';

// Mirrors the PUBLISH_EVENT record, spec section 15.3. 'cancelled' (migration 0016)
// is a human cancelling a pending schedule — never a connector attempt, so it's kept
// distinct from 'failed'.
export const PublishResultSchema = z.enum(['success', 'failed', 'cancelled']);
export type PublishResult = z.infer<typeof PublishResultSchema>;

export const PublishEventSchema = z.object({
  id: z.string().uuid(),
  contentId: z.string().uuid(),
  platform: z.string(),
  version: z.number().int().positive(),
  approvedBy: z.string(),
  approvedAt: z.string().datetime(),
  scheduledFor: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  platformPostId: z.string().nullable(),
  platformUrl: z.string().nullable(),
  connector: z.string(),
  result: PublishResultSchema,
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type PublishEvent = z.infer<typeof PublishEventSchema>;

export const NewPublishEventInputSchema = z.object({
  contentId: z.string().uuid(),
  platform: z.string(),
  version: z.number().int().positive(),
  approvedBy: z.string(),
  approvedAt: z.string().datetime(),
  scheduledFor: z.string().datetime().nullable().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
  platformPostId: z.string().nullable().optional(),
  platformUrl: z.string().nullable().optional(),
  connector: z.string(),
  result: PublishResultSchema,
  error: z.string().nullable().optional(),
});
export type NewPublishEventInput = z.infer<typeof NewPublishEventInputSchema>;
