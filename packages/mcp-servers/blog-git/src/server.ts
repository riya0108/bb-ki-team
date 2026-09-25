import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loadCategorySlugs, resolveCategorySlug } from './categories.js';
import { addFile, commit, currentHeadSha, isWorkingTreeClean, pullFastForwardOnly, push, resetHardTo } from './git.js';
import { buildMdxFileContents } from './mdxFile.js';

export interface BlogGitMcpServerDeps {
  repoPath: string;
  branch: string;
  siteBaseUrl: string;
}

function errorPayload(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}

// Chosen over linking the BB Visual Agent's Supabase URL directly: that URL is a
// signed link with a 60-day expiry (packages/mcp-servers/image-gen/src/
// supabaseStorage.ts — deliberate, so an unapproved image isn't permanently public
// before a human reviews it). Baking a signed URL into a permanently-live blog post
// would make its cover image silently 404 two months after publish. Committing the
// bytes into the site repo itself — same convention already used for this site's
// other post covers — has no expiry.
function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function createBlogGitMcpServer(deps: BlogGitMcpServerDeps): McpServer {
  const server = new McpServer({ name: 'bb-mcp-blog-git', version: '0.1.0' });

  server.registerTool(
    'publish_post',
    {
      description:
        'Commit one MDX blog post into the configured Astro site repo and push it to ' +
        `${deps.branch}. That push triggers the site's own CI to build and deploy — this is ` +
        'an IRREVERSIBLE, PUBLICLY VISIBLE publish action (the post goes live on the real site). ' +
        'Only call this from a step that runs after an approval gate has recorded an approved ' +
        'decision for this exact content version (CLAUDE.md/spec 15: never publish without ' +
        'approval).',
      inputSchema: {
        slug: z.string().min(1),
        title: z.string().min(1),
        description: z.string().min(1),
        categoryRaw: z.string().min(1),
        tags: z.array(z.string()).default([]),
        pubDateIso: z.string().datetime(),
        authorName: z.string().min(1),
        authorBio: z.string(),
        bodyMdx: z.string().min(1),
        commitMessage: z.string().min(1),
        // Raw bytes, not a URL — see extensionForMimeType's comment above for why.
        // Only ever populated by the caller for an APPROVED visual (see
        // packages/mcp-client/src/blogGitClient.ts).
        heroImage: z
          .object({
            base64Data: z.string().min(1),
            mimeType: z.string().min(1),
            alt: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      },
    },
    async ({
      slug,
      title,
      description,
      categoryRaw,
      tags,
      pubDateIso,
      authorName,
      authorBio,
      bodyMdx,
      commitMessage,
      heroImage,
    }) => {
      const relativePath = path.join('src', 'content', 'posts', `${slug}.mdx`);
      const absolutePath = path.join(deps.repoPath, relativePath);
      // Site-root-relative, matching astro:content's `heroImage: z.string()` and every
      // hand-added cover image already in this repo (e.g. src/content/posts/
      // is-ai-turning-your-productivity-into-a-money-drain.mdx uses this exact shape).
      const heroImageSitePath = heroImage ? `/images/posts/${slug}/cover.${extensionForMimeType(heroImage.mimeType)}` : null;
      const heroImageRelativePath = heroImageSitePath ? path.join('public', heroImageSitePath) : null;
      const heroImageAbsolutePath = heroImageRelativePath ? path.join(deps.repoPath, heroImageRelativePath) : null;
      let preOpSha: string | null = null;

      try {
        if (!(await isWorkingTreeClean(deps.repoPath))) {
          throw new Error(
            `${deps.repoPath} has uncommitted local changes — refusing to touch it. Commit, stash, or discard them first.`,
          );
        }

        await pullFastForwardOnly(deps.repoPath, deps.branch);
        preOpSha = await currentHeadSha(deps.repoPath);

        if (await fileExists(absolutePath)) {
          throw new Error(`${relativePath} already exists in the repo — refusing to overwrite it.`);
        }

        const validSlugs = await loadCategorySlugs(deps.repoPath);
        const category = resolveCategorySlug(categoryRaw, validSlugs);

        const mdx = buildMdxFileContents(
          {
            title,
            description,
            categorySlug: category.slug,
            tags,
            pubDateIso,
            authorName,
            authorBio,
            heroImageUrl: heroImageSitePath,
            heroImageAlt: heroImage?.alt ?? null,
          },
          bodyMdx,
        );

        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, mdx, 'utf8');
        await addFile(deps.repoPath, relativePath);

        if (heroImage && heroImageAbsolutePath && heroImageRelativePath) {
          await mkdir(path.dirname(heroImageAbsolutePath), { recursive: true });
          await writeFile(heroImageAbsolutePath, Buffer.from(heroImage.base64Data, 'base64'));
          await addFile(deps.repoPath, heroImageRelativePath);
        }

        const commitSha = await commit(deps.repoPath, commitMessage);

        try {
          await push(deps.repoPath, deps.branch);
        } catch (pushError) {
          await resetHardTo(deps.repoPath, preOpSha);
          throw pushError;
        }

        const url = `${deps.siteBaseUrl.replace(/\/$/, '')}/${category.slug}/${slug}/`;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ commitSha, url, categoryExactMatch: category.exactMatch }) },
          ],
        };
      } catch (error) {
        // Best-effort cleanup so a retry starts from a clean tree rather than piling
        // up a dangling local commit or an orphaned file (CLAUDE.md git safety rules).
        if (preOpSha) {
          await resetHardTo(deps.repoPath, preOpSha).catch(() => undefined);
        }
        await unlink(absolutePath).catch(() => undefined);
        if (heroImageAbsolutePath) {
          await unlink(heroImageAbsolutePath).catch(() => undefined);
        }
        return { content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }], isError: true };
      }
    },
  );

  return server;
}
