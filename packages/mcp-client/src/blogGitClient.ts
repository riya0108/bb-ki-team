import type { BlogGitConfig, Logger } from '@bb/core';
import { createBlogGitMcpServer } from '@bb/mcp-blog-git';
import type { ContentItem } from '@bb/shared-types';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { blogPostFragmentFromHtml, slugify } from './blogPost.js';
import { isToolTextContent, toolErrorMessage } from './mcpToolResponse.js';

export class BlogGitPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlogGitPublishError';
  }
}

const DEFAULT_AUTHOR_NAME = 'Bull or Bear Blogs';
const DEFAULT_AUTHOR_BIO =
  'The editorial desk at Bull or Bear Blogs, covering markets, money, and the news that moves them.';

interface PublishPostResult {
  commitSha: string;
  url: string;
  categoryExactMatch: boolean;
}

// Wraps the blog-git MCP server (packages/mcp-servers/blog-git) via an in-process
// InMemoryTransport pair rather than spawning it as a child process — a
// deliberate 2026-09-16 change (see packages/mcp-client/README or the commit that
// added this comment) to cut memory overhead on resource-constrained hosting and
// keep porting to environments without process-spawning (e.g. Cloudflare Workers)
// possible later. The MCP tool boundary itself — this connector can only ever call
// blog-git's own registered tools, never reach into arbitrary code — is unchanged;
// what's given up is the OS-process-level isolation a spawned subprocess added on
// top of that. `config` is passed directly as a plain object instead of via
// subprocess env vars, which achieves the same "only pass what's needed" scoping
// (CLAUDE.md: never expose API keys) without needing a child process to enforce it.
// This is platform "blog"'s real publish connector: the live site (bullorbear.in)
// is a static Astro site deployed by its own GitHub Actions workflow on every push
// to its default branch, so "publishing" means committing an MDX file into that
// repo and pushing — there is no platform API to call (see apps/api/src/deps.ts).
export function createBlogGitPublishConnector(
  config: BlogGitConfig,
  _logger: Logger,
): PublishConnector & { close(): Promise<void> } {
  const client = new Client({ name: 'bb-connector-blog-git', version: '0.1.0' });
  let connected: Promise<void> | null = null;

  function ensureConnected(): Promise<void> {
    if (!connected) {
      const server = createBlogGitMcpServer({
        repoPath: config.repoPath,
        branch: config.branch,
        siteBaseUrl: config.siteBaseUrl,
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      connected = Promise.all([client.connect(clientTransport), server.connect(serverTransport)]).then(
        () => undefined,
      );
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

      if (response.isError) {
        throw new BlogGitPublishError(toolErrorMessage(textContent.text));
      }

      const parsed: unknown = JSON.parse(textContent.text);
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
