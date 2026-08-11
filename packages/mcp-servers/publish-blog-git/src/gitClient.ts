import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args]);
  return stdout.trim();
}

/**
 * Refuses to touch a directory that doesn't look like the actual blog repo —
 * this server writes files and pushes commits, so a wrong BLOG_REPO_PATH
 * must fail loudly, never silently write into the wrong place.
 */
export function assertRepoLooksRight(repoPath: string): void {
  if (!existsSync(path.join(repoPath, 'src', 'content', 'posts'))) {
    throw new Error(
      `BLOG_REPO_PATH "${repoPath}" doesn't look like the blog repo (missing src/content/posts)`,
    );
  }
  if (!existsSync(path.join(repoPath, 'wrangler.jsonc'))) {
    throw new Error(
      `BLOG_REPO_PATH "${repoPath}" doesn't look like the blog repo (missing wrangler.jsonc)`,
    );
  }
}

/**
 * Never sweeps the user's own unrelated in-progress work into our commit —
 * only proceeds if the working tree was already clean before we touched it.
 */
export async function assertCleanWorkingTree(repoPath: string): Promise<void> {
  const status = await git(repoPath, ['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error(
      `${repoPath} has uncommitted changes — refusing to commit on top of them:\n${status}`,
    );
  }
}

export interface CommitAndPushInput {
  relativeFilePath: string;
  fileContents: string;
  commitMessage: string;
  branch: string;
}

/** Writes the file, commits it, and pushes — never force-pushes; a rejected push surfaces as a plain error. */
export async function writeCommitAndPush(
  repoPath: string,
  input: CommitAndPushInput,
): Promise<{ commitSha: string }> {
  const absolutePath = path.join(repoPath, input.relativeFilePath);
  await writeFile(absolutePath, input.fileContents, 'utf-8');
  await git(repoPath, ['add', input.relativeFilePath]);
  await git(repoPath, ['commit', '-m', input.commitMessage]);
  await git(repoPath, ['push', 'origin', input.branch]);
  const commitSha = await git(repoPath, ['rev-parse', 'HEAD']);
  return { commitSha };
}

export interface StyleSample {
  title: string;
  bodyExcerpt: string;
}

const MAX_BODY_EXCERPT_WORDS = 400;

/** Pulls a double-quoted `key: "..."` frontmatter value written by buildFrontmatter. */
function extractQuotedField(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(".*")$`, 'm').exec(frontmatter);
  const quoted = match?.[1];
  if (!quoted) return undefined;
  try {
    return JSON.parse(quoted) as string;
  } catch {
    return undefined;
  }
}

/** Pulls a bare (unquoted) `key: value` frontmatter scalar, e.g. `category: ai` or `pubDate: 2026-08-01`. */
function extractBareField(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(\\S.*)$`, 'm').exec(frontmatter);
  return match?.[1]?.trim();
}

/** Pulls the `tags: ["a", "b"]` frontmatter array written by buildFrontmatter. */
function extractTagsField(frontmatter: string): string[] {
  const match = /^tags:\s*\[(.*)\]$/m.exec(frontmatter);
  const inner = match?.[1]?.trim();
  if (!inner) return [];
  try {
    return JSON.parse(`[${inner}]`) as string[];
  } catch {
    return [];
  }
}

/** Pulls the double-quoted `title: "..."` frontmatter value written by buildFrontmatter. */
function extractTitle(fileContents: string, frontmatterEnd: number): string | undefined {
  return extractQuotedField(fileContents.slice(0, frontmatterEnd), 'title');
}

/** Strips MDX `<img .../>` tags and blank lines so the excerpt is prose the model can learn voice/tone from. */
function excerptBody(body: string): string {
  const withoutImageTags = body.replace(/<img\b[^>]*\/?>/gi, '');
  const words = withoutImageTags.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_BODY_EXCERPT_WORDS).join(' ');
}

/**
 * Read-only style reference for the Writer agent — the most recently
 * modified published posts, so new drafts can match the site's established
 * voice/structure rather than inventing a generic tone. Deliberately never
 * touches the working tree (no git add/commit/push), unlike every other
 * function in this file.
 */
export async function listStyleSamples(repoPath: string, count: number): Promise<StyleSample[]> {
  const postsDir = path.join(repoPath, 'src', 'content', 'posts');
  const entries = await readdir(postsDir);
  const mdxFiles = entries.filter((name) => name.endsWith('.mdx'));

  const withMtime = await Promise.all(
    mdxFiles.map(async (name) => {
      const filePath = path.join(postsDir, name);
      const { mtimeMs } = await stat(filePath);
      return { filePath, mtimeMs };
    }),
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const samples: StyleSample[] = [];
  for (const { filePath } of withMtime.slice(0, count)) {
    const fileContents = await readFile(filePath, 'utf-8');
    if (!fileContents.startsWith('---\n')) continue;
    const frontmatterEnd = fileContents.indexOf('\n---\n', 4);
    if (frontmatterEnd === -1) continue;
    const title = extractTitle(fileContents, frontmatterEnd);
    if (!title) continue;
    const body = fileContents.slice(frontmatterEnd + 5);
    samples.push({ title, bodyExcerpt: excerptBody(body) });
  }
  return samples;
}

export interface ArchivePostRecord {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  pubDate: string;
  description?: string;
}

/**
 * Content-only archive listing for blog-topic-finder's duplicate/overlap
 * detection and content-DNA extraction — title/category/tags/date/description
 * only, deliberately no view/CTR/engagement fields since no real post
 * analytics exist yet (plan §"Blog archive data" decision). Read-only, like
 * listStyleSamples, but returns every post rather than just the N most recent.
 */
export async function listArchivePosts(repoPath: string): Promise<ArchivePostRecord[]> {
  const postsDir = path.join(repoPath, 'src', 'content', 'posts');
  const entries = await readdir(postsDir);
  const mdxFiles = entries.filter((name) => name.endsWith('.mdx'));

  const posts: ArchivePostRecord[] = [];
  for (const name of mdxFiles) {
    const filePath = path.join(postsDir, name);
    const fileContents = await readFile(filePath, 'utf-8');
    if (!fileContents.startsWith('---\n')) continue;
    const frontmatterEnd = fileContents.indexOf('\n---\n', 4);
    if (frontmatterEnd === -1) continue;
    const frontmatter = fileContents.slice(0, frontmatterEnd);

    const title = extractQuotedField(frontmatter, 'title');
    const category = extractBareField(frontmatter, 'category');
    const pubDate = extractBareField(frontmatter, 'pubDate');
    if (!title || !category || !pubDate) continue;

    const description = extractQuotedField(frontmatter, 'description');
    posts.push({
      slug: name.replace(/\.mdx$/, ''),
      title,
      category,
      tags: extractTagsField(frontmatter),
      pubDate,
      ...(description !== undefined ? { description } : {}),
    });
  }
  return posts;
}
