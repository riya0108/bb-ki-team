import { z } from 'zod';
import { ArchivePostSchema, ContentDnaSchema, type ArchivePost, type ContentDna } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';
import type { ArchiveMcp } from '../mcpClient.js';

const ListArchivePostsOutputSchema = z.object({ posts: z.array(ArchivePostSchema) });

const EMPTY_CONTENT_DNA: ContentDna = {
  bestCategories: [],
  bestArticleTypes: [],
  bestLengthRange: '900-2000 words (site default, no archive data yet)',
  bestTitlePattern: 'unknown — not enough archive data',
  strongestAudience: 'Indian Gen Z / young professionals (site default, no archive data yet)',
  strongestAngles: [],
};

/**
 * Reads the real blog archive (content only — title/category/tags/date, no
 * performance stats, since no analytics pipeline exists yet) and derives a
 * "content DNA" summary. With very few or zero posts, most fields fall back
 * to honest defaults rather than a fabricated pattern (plan §6).
 */
export async function loadArchiveIntelligence(
  providers: LlmProviderConfig[],
  archive: ArchiveMcp,
): Promise<{ posts: ArchivePost[]; contentDna: ContentDna }> {
  const raw = await archive.callTool('list_archive_posts', {});
  const { posts } = ListArchivePostsOutputSchema.parse(raw);

  if (posts.length < 5) {
    return { posts, contentDna: EMPTY_CONTENT_DNA };
  }

  const listing = posts
    .map((p) => `- [${p.category}] "${p.title}"${p.description ? ` — ${p.description}` : ''}`)
    .join('\n');

  const contentDna = await generateStructured({
    providers,
    toolName: 'content_dna',
    schema: ContentDnaSchema,
    system:
      'You analyze a blog\'s published-post archive (titles, categories, descriptions only — no ' +
      'performance data exists yet) and infer its editorial "content DNA": which categories and ' +
      'article types it leans on, an approximate best length range, a recurring title pattern, its ' +
      'likely strongest audience, and the angles it returns to most. Be honest about weak signal — ' +
      'this is inferred from content alone, not real performance, so keep claims modest and general ' +
      'rather than overconfident.',
    prompt: `Archive (${String(posts.length)} posts):\n${listing}`,
  });

  return { posts, contentDna };
}
