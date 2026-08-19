import { z } from 'zod';

export const SourceTypeSchema = z.enum([
  'wikipedia',
  'news',
  'youtube',
  'trends',
  'competitor',
  'hackernews',
  'instagram',
  'reddit',
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;
