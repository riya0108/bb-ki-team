import type { BlogGitConfig, Logger } from '@bb/core';
import type { Queryable } from '@bb/db';
import { createBlogGitMcpServer } from '@bb/mcp-blog-git';
import type { ContentItem } from '@bb/shared-types';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { resolveApprovedVisual } from './approvedVisual.js';
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

// Downloads the approved visual's bytes from its (still-valid, short-lived) signed
// Supabase URL so publish_post can commit them straight into the site repo instead
// of linking that URL from a permanently-live post — see
// packages/mcp-servers/blog-git/src/server.ts's extensionForMimeType comment for
// why a signed link can't be the long-term source of truth here. Best-effort: a
// download failure must not block publishing the already-approved text (the post
// just goes out with the site's placeholder cover, same as before the visual agent).
async function downloadHeroImage(
  assetUrl: string,
  mimeType: string,
  logger: Logger,
): Promise<{ base64Data: string; mimeType: string } | null> {
  try {
    const response = await fetch(assetUrl);
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Failed to download approved visual asset for blog cover image');
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return { base64Data: bytes.toString('base64'), mimeType };
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to download approved visual asset for blog cover image',
    );
    return null;
  }
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
  logger: Logger,
  pool: Queryable,
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

      // Gate lives in resolveApprovedVisual (approvedVisual.ts) — shared with the X/Buffer
      // connector so both platforms attach the same approved image.
      const visual = await resolveApprovedVisual(pool, item.id);
      const heroImage = visual?.masterAsset.assetUrl
        ? await downloadHeroImage(visual.masterAsset.assetUrl, visual.masterAsset.mimeType ?? 'image/png', logger)
        : null;

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
          heroImage: heroImage ? { ...heroImage, alt: visual?.concept ?? null } : null,
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
