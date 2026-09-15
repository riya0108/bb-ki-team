import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import type { BlogGitConfig, Logger } from '@bb/core';
import type { ContentItem } from '@bb/shared-types';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { blogPostFragmentFromHtml, slugify } from './blogPost.js';

export class BlogGitPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlogGitPublishError';
  }
}

const require = createRequire(import.meta.url);
const BLOG_GIT_SERVER_ENTRY = fileURLToPath(
  new URL('../../mcp-servers/blog-git/src/index.ts', import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const DEFAULT_AUTHOR_NAME = 'Bull or Bear Blogs';
const DEFAULT_AUTHOR_BIO =
  'The editorial desk at Bull or Bear Blogs, covering markets, money, and the news that moves them.';

interface ToolTextContent {
  type: 'text';
  text: string;
}

function isToolTextContent(value: unknown): value is ToolTextContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

interface PublishPostResult {
  commitSha: string;
  url: string;
  categoryExactMatch: boolean;
}

// Wraps the blog-git MCP server (packages/mcp-servers/blog-git) the same way
// bufferClient.ts wraps the Buffer MCP server — a dedicated child process, spawned
// with only the repo config it needs (StdioClientTransport does not inherit the
// parent's full env by default). This is platform "blog"'s real publish connector:
// the live site (bullorbear.in) is a static Astro site deployed by its own GitHub
// Actions workflow on every push to its default branch, so "publishing" means
// committing an MDX file into that repo and pushing — there is no platform API to
// call (see apps/api/src/deps.ts).
export function createBlogGitPublishConnector(
  config: BlogGitConfig,
  _logger: Logger,
): PublishConnector & { close(): Promise<void> } {
  const client = new Client({ name: 'bb-connector-blog-git', version: '0.1.0' });
  let connected: Promise<void> | null = null;

  function ensureConnected(): Promise<void> {
    if (!connected) {
      const transport = new StdioClientTransport({
        command: require.resolve('tsx/cli'),
        args: [BLOG_GIT_SERVER_ENTRY],
        cwd: REPO_ROOT,
        env: {
          BLOG_REPO_PATH: config.repoPath,
          BLOG_REPO_BRANCH: config.branch,
          BLOG_SITE_BASE_URL: config.siteBaseUrl,
        },
      });
      connected = client.connect(transport);
    }
    return connected;
  }

  return {
    name: 'blog-git',
    async publish(item: ContentItem): Promise<{ platformPostId: string; platformUrl: string }> {
      await ensureConnected();
      const fragment = blogPostFragmentFromHtml(item.currentText);
      const slug = slugify(fragment.title);

      const response = await client.callTool({
        name: 'publish_post',
        arguments: {
          slug,
          title: fragment.title,
          description: fragment.metaDescription,
          categoryRaw: fragment.categoryRaw,
          tags: [],
          pubDateIso: new Date().toISOString(),
          authorName: DEFAULT_AUTHOR_NAME,
          authorBio: DEFAULT_AUTHOR_BIO,
          bodyMdx: fragment.bodyMdx,
          commitMessage: `Add blog post: ${fragment.title}`,
        },
      });

      const content = Array.isArray(response.content) ? response.content : [];
      const textContent = content.find(isToolTextContent);
      if (!textContent) {
        throw new BlogGitPublishError('publish_post returned no text content');
      }

      const parsed: unknown = JSON.parse(textContent.text);
      if (response.isError) {
        const message =
          typeof (parsed as { message?: unknown }).message === 'string'
            ? (parsed as { message: string }).message
            : 'publish_post reported an error';
        throw new BlogGitPublishError(message);
      }

      const result = parsed as PublishPostResult;
      return { platformPostId: result.commitSha, platformUrl: result.url };
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

// Static-site "scheduling" has no external system to hand a future time to (unlike
// Buffer's own scheduler for X) — requestSchedule just records scheduledFor in our
// own DB, and apps/worker's poll loop calls this same publish connector once that
// time arrives (mirrors createXScheduleConnector in xClient.ts).
export function createBlogGitScheduleConnector(): ScheduleConnector {
  return {
    name: 'blog-git-worker-scheduled',
    schedule(): Promise<void> {
      return Promise.resolve();
    },
  };
}
