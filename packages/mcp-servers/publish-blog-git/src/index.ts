import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createLogger, loadEnv } from '@ai-company/core';
import {
  assertCleanWorkingTree,
  assertRepoLooksRight,
  listArchivePosts,
  listStyleSamples,
  writeCommitAndPush,
} from './gitClient.js';
import { buildFrontmatter } from './frontmatter.js';

const env = loadEnv(
  z.object({
    BLOG_REPO_PATH: z.string().min(1, 'BLOG_REPO_PATH is required to run the publish-blog-git MCP server'),
    BLOG_GIT_BRANCH: z.string().min(1).default('master'),
    // Safety default: draft. Astro's getStaticPaths excludes draft:true
    // posts entirely at build time — the commit ships and deploys, but the
    // page has no route until this is explicitly set to "live".
    BLOG_PUBLISH_STATUS: z.enum(['draft', 'live']).default('draft'),
    BLOG_SITE_URL: z.string().url().default('https://bullorbear.in'),
  }),
);

// stdout is the JSON-RPC channel for the stdio transport — all logging must go to stderr.
const logger = createLogger({ runId: 'mcp-publish-blog-git' }, process.stderr);

assertRepoLooksRight(env.BLOG_REPO_PATH);

const server = new McpServer({ name: 'publish-blog-git', version: '0.1.0' });

const PublishPostInput = z.object({
  slug: z.string().min(1),
  frontmatter: z.object({
    title: z.string().min(1),
    seoTitle: z.string().optional(),
    description: z.string().min(1),
    category: z.string().min(1),
    tags: z.array(z.string()).default([]),
    pubDate: z.string().min(1),
    author: z.object({ name: z.string().min(1), bio: z.string().min(1) }),
  }),
  content: z.string().min(1),
});

const PublishPostOutput = z.object({
  slug: z.string(),
  url: z.string().url(),
  status: z.enum(['draft', 'live']),
  commitSha: z.string(),
});

server.registerTool(
  'publish_post',
  {
    title: 'Publish Blog Post (git)',
    description:
      'Commits a new .mdx post to the configured blog repo and pushes it — the push triggers that ' +
      'repo\'s GitHub Actions deploy. The resulting draft/live status is fixed by this server\'s own ' +
      'BLOG_PUBLISH_STATUS config, not by the caller.',
    inputSchema: PublishPostInput,
    outputSchema: PublishPostOutput,
  },
  async ({ slug, frontmatter, content }) => {
    try {
      await assertCleanWorkingTree(env.BLOG_REPO_PATH);

      const fileContents =
        buildFrontmatter({
          title: frontmatter.title,
          ...(frontmatter.seoTitle !== undefined ? { seoTitle: frontmatter.seoTitle } : {}),
          description: frontmatter.description,
          category: frontmatter.category,
          tags: frontmatter.tags,
          pubDate: frontmatter.pubDate,
          author: frontmatter.author,
          draft: env.BLOG_PUBLISH_STATUS === 'draft',
        }) +
        '\n' +
        content +
        '\n';

      const { commitSha } = await writeCommitAndPush(env.BLOG_REPO_PATH, {
        relativeFilePath: `src/content/posts/${slug}.mdx`,
        fileContents,
        commitMessage: `Add blog post: ${frontmatter.title}`,
        branch: env.BLOG_GIT_BRANCH,
      });

      const result = {
        slug,
        url: `${env.BLOG_SITE_URL}/${frontmatter.category}/${slug}/`,
        status: env.BLOG_PUBLISH_STATUS,
        commitSha,
      };
      logger.info('post committed and pushed', result);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('publish_post failed', { error: message });
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const GetStyleSamplesInput = z.object({
  count: z.number().int().min(1).max(10).default(3),
});

const GetStyleSamplesOutput = z.object({
  samples: z.array(z.object({ title: z.string(), bodyExcerpt: z.string() })),
});

server.registerTool(
  'get_style_samples',
  {
    title: 'Get Style Samples (read-only)',
    description:
      'Returns the most recently modified published posts (title + body excerpt) from the blog repo, ' +
      "so the Writer agent can match the site's established voice and structure. Read-only — never " +
      'touches the working tree.',
    inputSchema: GetStyleSamplesInput,
    outputSchema: GetStyleSamplesOutput,
  },
  async ({ count }) => {
    try {
      const samples = await listStyleSamples(env.BLOG_REPO_PATH, count);
      const result = { samples };
      logger.info('get_style_samples served', { requested: count, returned: samples.length });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('get_style_samples failed', { error: message });
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const ListArchivePostsInput = z.object({});

const ListArchivePostsOutput = z.object({
  posts: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      category: z.string(),
      tags: z.array(z.string()),
      pubDate: z.string(),
      description: z.string().optional(),
    }),
  ),
});

server.registerTool(
  'list_archive_posts',
  {
    title: 'List Archive Posts (read-only)',
    description:
      'Returns every post in the blog repo — title, category, tags, publish date, description. ' +
      'Content only, no performance stats (no analytics pipeline exists yet). Used by blog-topic-finder ' +
      "for content-DNA extraction and duplicate/overlap detection against the site's real archive. " +
      'Read-only — never touches the working tree.',
    inputSchema: ListArchivePostsInput,
    outputSchema: ListArchivePostsOutput,
  },
  async () => {
    try {
      const posts = await listArchivePosts(env.BLOG_REPO_PATH);
      const result = { posts };
      logger.info('list_archive_posts served', { returned: posts.length });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('list_archive_posts failed', { error: message });
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info('publish-blog-git MCP server listening on stdio', {
  repoPath: env.BLOG_REPO_PATH,
  publishStatus: env.BLOG_PUBLISH_STATUS,
});
