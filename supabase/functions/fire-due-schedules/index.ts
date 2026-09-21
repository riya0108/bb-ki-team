// Deno Edge Function — the pg_cron/pg_net replacement for apps/worker's local poll
// loop (packages/workflows/src/publishing.ts's publishDueSchedules), scoped to
// platform "blog" only. pg_cron fires this once a minute (see
// packages/db/migrations/0014_fire_due_schedules_cron.sql); it finds every blog
// content item whose scheduled_for has arrived and still sits in status "scheduled",
// and publishes it via GitHub's Contents API (see _shared/githubContents.ts for why
// that replaces a local `git push` here — no persistent checkout in a stateless
// function).
//
// Buffer/X scheduling deliberately stays on apps/worker for now: Buffer's own
// create-post call blocks for minutes waiting for a "sent" confirmation, which
// doesn't fit a request/response Edge Function invocation cleanly.
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { createFile, getFileContent, type GitHubRepoConfig } from '../_shared/githubContents.ts';
import { blogPostFragmentFromHtml, buildMdxFileContents, parseCategorySlugs, resolveCategorySlug, slugify } from '../_shared/blogPost.ts';

const DEFAULT_AUTHOR_NAME = 'Bull or Bear Blogs';
const DEFAULT_AUTHOR_BIO =
  'The editorial desk at Bull or Bear Blogs, covering markets, money, and the news that moves them.';

interface ContentItemRow {
  id: string;
  platform: string;
  status: string;
  current_text: string;
  topic: string | null;
  approved_version: number | null;
  approved_by: string | null;
  approved_at: string | null;
}

interface DueRow {
  content_id: string;
  scheduled_for: string;
  created_at: string;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

// Mirrors packages/core/src/notify.ts's sendPublishNotification for the one
// runtime that can't import a workspace package (a stateless Deno Edge Function).
// Optional — RESEND_API_KEY/NOTIFY_EMAIL_TO unset means no email is sent, same
// "unset = honestly not configured" pattern as every other connector in this repo.
// Never thrown from: a notification failure must not turn an already-successful,
// already-recorded publish into an error response.
async function sendPublishNotification(topic: string | null, platformUrl: string | null): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('NOTIFY_EMAIL_TO');
  if (!apiKey || !to) return;
  const from = Deno.env.get('NOTIFY_EMAIL_FROM') ?? 'Bull or Bear <onboarding@resend.dev>';

  const subject = `Published to blog${topic ? `: ${topic}` : ''}`;
  const linkHtml = platformUrl
    ? `<p><a href="${platformUrl}">${platformUrl}</a></p>`
    : '<p>(no link was recorded for this publish)</p>';
  const html = `<p>Your scheduled blog post ${topic ? `"${topic}" ` : ''}just went live.</p>${linkHtml}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!response.ok) {
      console.error(`Resend publish notification email was rejected: ${response.status}`);
    }
  } catch (error) {
    console.error(`Failed to send publish notification email: ${error instanceof Error ? error.message : String(error)}`);
  }
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('unauthorized', { status: 401 });
  }

  const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'));
  const github: GitHubRepoConfig = {
    token: requiredEnv('GITHUB_TOKEN'),
    owner: requiredEnv('BLOG_REPO_OWNER'),
    repo: requiredEnv('BLOG_REPO_NAME'),
    branch: requiredEnv('BLOG_REPO_BRANCH'),
  };
  const siteBaseUrl = requiredEnv('BLOG_SITE_BASE_URL');

  const nowIso = new Date().toISOString();
  const { data: dueRows, error: dueError } = await supabase
    .from('publish_events')
    .select('content_id, scheduled_for, created_at')
    .eq('platform', 'blog')
    .eq('result', 'success')
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', nowIso)
    .order('created_at', { ascending: false });

  if (dueError) {
    return new Response(JSON.stringify({ error: dueError.message }), { status: 500 });
  }

  // DISTINCT ON (content_id) equivalent — keep only the latest scheduling event per
  // item (mirrors listDueSchedules's ORDER BY ... DESC + DISTINCT ON in publishEvents.ts).
  const latestByContentId = new Map<string, DueRow>();
  for (const row of (dueRows ?? []) as DueRow[]) {
    if (!latestByContentId.has(row.content_id)) latestByContentId.set(row.content_id, row);
  }

  const results: { contentId: string; result: 'success' | 'failed' | 'skipped'; detail?: string }[] = [];

  for (const [contentId] of latestByContentId) {
    const { data: item, error: itemError } = await supabase
      .from('content_items')
      .select('id, platform, status, current_text, topic, approved_version, approved_by, approved_at')
      .eq('id', contentId)
      .single<ContentItemRow>();

    if (itemError || !item) {
      results.push({ contentId, result: 'skipped', detail: itemError?.message ?? 'content item not found' });
      continue;
    }
    if (item.status !== 'scheduled' || !item.approved_version || !item.approved_by || !item.approved_at) {
      // Already fired by a previous tick, or approval was revoked — nothing to do.
      results.push({ contentId, result: 'skipped', detail: `status is "${item.status}", not a pending scheduled item` });
      continue;
    }

    try {
      const fragment = blogPostFragmentFromHtml(item.current_text);
      const slug = slugify(fragment.title);
      const relativePath = `src/content/posts/${slug}.mdx`;

      const existing = await getFileContent(github, relativePath);
      if (existing !== null) {
        throw new Error(`${relativePath} already exists in the repo — refusing to overwrite it.`);
      }

      const categoriesJson = await getFileContent(github, 'src/content/categories.json');
      if (categoriesJson === null) throw new Error('src/content/categories.json not found in target repo');
      const category = resolveCategorySlug(fragment.categoryRaw, parseCategorySlugs(categoriesJson));

      const mdx = buildMdxFileContents(
        {
          title: fragment.title,
          description: fragment.metaDescription,
          categorySlug: category.slug,
          tags: [],
          pubDateIso: nowIso,
          authorName: DEFAULT_AUTHOR_NAME,
          authorBio: DEFAULT_AUTHOR_BIO,
        },
        fragment.bodyMdx,
      );

      const { commitSha } = await createFile(github, relativePath, mdx, `Add blog post: ${fragment.title}`);
      const url = `${siteBaseUrl.replace(/\/$/, '')}/${category.slug}/${slug}/`;

      // Conditional update — only flips status if it's still "scheduled", so two
      // overlapping invocations (shouldn't happen at a 1/minute cadence, but cheap
      // to guard) can't both report success for the same item.
      const { data: updated } = await supabase
        .from('content_items')
        .update({ status: 'published' })
        .eq('id', contentId)
        .eq('status', 'scheduled')
        .select('id');

      if (!updated || updated.length === 0) {
        throw new Error('content item was no longer "scheduled" at write time (concurrent update) — not recording a duplicate publish');
      }

      await supabase.from('publish_events').insert({
        content_id: contentId,
        platform: 'blog',
        version: item.approved_version,
        approved_by: item.approved_by,
        approved_at: item.approved_at,
        published_at: new Date().toISOString(),
        platform_post_id: commitSha,
        platform_url: url,
        connector: 'blog-git-github-api',
        result: 'success',
      });

      await sendPublishNotification(item.topic, url);
      results.push({ contentId, result: 'success', detail: url });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from('publish_events').insert({
        content_id: contentId,
        platform: 'blog',
        version: item.approved_version,
        approved_by: item.approved_by,
        approved_at: item.approved_at,
        connector: 'blog-git-github-api',
        result: 'failed',
        error: message,
      });
      results.push({ contentId, result: 'failed', detail: message });
    }
  }

  return new Response(JSON.stringify({ checked: latestByContentId.size, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
