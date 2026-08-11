import { z } from 'zod';

export const SourceTypeSchema = z.enum([
  'wikipedia',
  'news',
  'youtube',
  'trends',
  'competitor',
  'hackernews',
  'instagram',
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;
