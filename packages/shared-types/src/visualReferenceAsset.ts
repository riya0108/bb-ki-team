import { z } from 'zod';

// 'character' — photos of a recurring person (poses/expressions) so AI-generated
// thumbnails keep the same identity across posts. 'thumbnail_style' — example
// thumbnails to match art direction/mood/color-grading. See visualAsset.ts for the
// per-content-version generated output this feeds into.
export const VisualReferenceKindSchema = z.enum(['character', 'thumbnail_style']);
export type VisualReferenceKind = z.infer<typeof VisualReferenceKindSchema>;

export const VisualReferenceAssetSchema = z.object({
  id: z.string().uuid(),
  platform: z.string(),
  kind: VisualReferenceKindSchema,
  label: z.string().nullable(),
  assetPath: z.string(),
  assetUrl: z.string(),
  mimeType: z.string(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});
export type VisualReferenceAsset = z.infer<typeof VisualReferenceAssetSchema>;
