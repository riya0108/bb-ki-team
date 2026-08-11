import { z } from 'zod';

/** The Content Writer's output (plan §9-10). Revisions bump draftVersion rather than starting over. */
export const BlogDraftSchema = z.object({
  runId: z.string().min(1),
  draftVersion: z.number().int().min(1),
  title: z.string().min(1),
  /** A slightly more search-friendly variant of the title, if the writer produced one. */
  seoTitle: z.string().min(1).optional(),
  excerpt: z.string().min(1),
  content: z.string().min(1),
  wordCount: z.number().int().min(0),
  sources: z.array(z.string().url()).min(1),
  generatedAt: z.string(),
});
export type BlogDraft = z.infer<typeof BlogDraftSchema>;
