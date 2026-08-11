import { z } from 'zod';
import { createLogger, loadLlmProviders, newRunId } from '@ai-company/core';
import {
  PublishedBlogPostSchema,
  type PublishedBlogPost,
  type PublishPostTaskPayload,
} from '@ai-company/shared-types';
import { connectBlogGit } from './mcpClient.js';
import { classifyCategory } from './pipeline/classifyCategory.js';
import { slugify } from './slugify.js';

const SITE_AUTHOR = {
  name: 'Bull or Bear Blogs',
  bio: 'The editorial desk at Bull or Bear Blogs, covering markets, money, and the news that moves them.',
};

const PublishResultSchema = z.object({
  slug: z.string(),
  url: z.string().url(),
  status: z.enum(['draft', 'live']),
  commitSha: z.string(),
});

/**
 * The plan's WordPress-Publisher role, adapted to the site's real
 * architecture: the only agent that writes to the blog's git repo. The only
 * place a task of this type is ever created is the blog workflow's "draft"
 * approval gate recording `approved` (packages/workflows/src/approvalResolvers.ts).
 */
export async function runBlogPublisherAgent(payload: PublishPostTaskPayload): Promise<PublishedBlogPost> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });
  const { draft } = payload;

  logger.info('blog-publisher agent started', { title: draft.title, draftVersion: draft.draftVersion });

  const category = await classifyCategory(providers, draft.title, draft.excerpt);
  const slug = slugify(draft.title);

  const blogGit = await connectBlogGit();
  try {
    const raw = await blogGit.callTool('publish_post', {
      slug,
      frontmatter: {
        title: draft.title,
        ...(draft.seoTitle ? { seoTitle: draft.seoTitle } : {}),
        description: draft.excerpt,
        category,
        tags: [],
        pubDate: new Date().toISOString().slice(0, 10),
        author: SITE_AUTHOR,
      },
      content: draft.content,
    });
    const result = PublishResultSchema.parse(raw);
    logger.info('post committed and pushed', result);

    return PublishedBlogPostSchema.parse({
      slug: result.slug,
      url: result.url,
      status: result.status,
      commitSha: result.commitSha,
      publishedAt: new Date().toISOString(),
    });
  } finally {
    await blogGit.close();
  }
}
