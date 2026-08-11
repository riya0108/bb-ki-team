import { z } from 'zod';

/**
 * Mirrors ~/Downloads/BLOG/src/content/categories.json exactly. No shared
 * package links the two repos, so this list is manually kept in sync — if
 * a category is ever added/removed on the site, update it here too.
 */
export const BlogCategorySlugSchema = z.enum([
  'ai',
  'tech',
  'money',
  'finance',
  'politics',
  'personal-finance',
  'world',
  'business',
  'lifestyle',
]);
export type BlogCategorySlug = z.infer<typeof BlogCategorySlugSchema>;

/** Result of the Blog Publisher agent's single job — a git commit + push to the live site's repo. */
export const PublishedBlogPostSchema = z.object({
  slug: z.string().min(1),
  url: z.string().url(),
  status: z.enum(['draft', 'live']),
  commitSha: z.string().min(1),
  publishedAt: z.string(),
});
export type PublishedBlogPost = z.infer<typeof PublishedBlogPostSchema>;
