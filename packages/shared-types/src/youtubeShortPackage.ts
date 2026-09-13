import { z } from 'zod';

import { ContentStatusSchema } from './contentItem.js';
import { PublishActionSchema } from './publishAction.js';

// Mirrors the YOUTUBE_SHORT output contract, spec section 11.3.
export const YoutubeShortPackageSchema = z.object({
  contentId: z.string().uuid(),
  status: ContentStatusSchema,
  topic: z.string(),
  corePromise: z.string(),
  hookOptions: z.array(z.string()).min(1).max(3),
  titleOptions: z.array(z.string()).min(1).max(3),
  spokenScript: z.string(),
  visualBeats: z.array(z.string()).min(1),
  onScreenText: z.array(z.string()).default([]),
  bRoll: z.array(z.string()).default([]),
  editingPacing: z.string().nullable(),
  description: z.string(),
  sources: z.array(z.string()).default([]),
  cta: z.string().nullable(),
  contentDnaVersion: z.number().int().positive(),
  approvalRequired: z.literal(true),
  publishAction: PublishActionSchema,
});
export type YoutubeShortPackage = z.infer<typeof YoutubeShortPackageSchema>;
