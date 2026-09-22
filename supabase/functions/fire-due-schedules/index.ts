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

import {
  createFile,
  getFileContent,
  getFileContentWithSha,
  getLatestCommitShaForPath,
  updateFile,
  waitForWorkflowRun,
  type GitHubRepoConfig,
} from '../_shared/githubContents.ts';
import { blogPostFragmentFromHtml, buildMdxFileContents, parseCategorySlugs, resolveCategorySlug, slugify } from '../_shared/blogPost.ts';

// How long to wait, per invocation, for the site repo's Deploy workflow (lint ->
// build -> Cloudflare deploy) to conclude after a commit lands. Observed runs take
// 30-45s; this leaves generous margin while staying well inside an Edge Function's
// execution budget. If the workflow hasn't concluded within this window, the item is
// left "scheduled" (not falsely marked published) and the next pg_cron tick re-checks
// the same commit's status via getLatestCommitShaForPath, rather than re-attempting
// the commit.
const DEPLOY_WAIT_TIMEOUT_MS = 100_000;
const DEPLOY_POLL_INTERVAL_MS = 5_000;

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

// Alerts a human that a publish attempt did NOT result in a live post — the
// counterpart to sendPublishNotification for the failure path, which previously had
// no email at all (the only signal was a `result: 'failed'` row in publish_events
// that nobody was watching). Same "unset env = not configured, don't throw" pattern.
async function sendPublishFailureAlert(topic: string | null, detail: string, runUrl: string | null): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('NOTIFY_EMAIL_TO');
  if (!apiKey || !to) return;
  const from = Deno.env.get('NOTIFY_EMAIL_FROM') ?? 'Bull or Bear <onboarding@resend.dev>';

  const subject = `Blog publish FAILED${topic ? `: ${topic}` : ''} — not live, needs attention`;
  const runHtml = runUrl ? `<p><a href="${runUrl}">View the failed deploy run</a></p>` : '';
  const html = `<p>A scheduled blog post ${topic ? `"${topic}" ` : ''}did not go live.</p><p>${detail}</p>${runHtml}`;

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
      console.error(`Resend publish failure alert email was rejected: ${response.status}`);
    }
  } catch (error) {
    console.error(`Failed to send publish failure alert email: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function unescapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\(.)/g, (_match, ch: string) => ch);
}

// Reads the `title:` frontmatter field back out of an already-committed MDX file, so
// a retry can tell "this is (at least) a prior attempt at the same post" apart from
// "a different post happens to slugify to the same filename" (must keep refusing to
// overwrite the latter).
function extractFrontmatterTitle(mdx: string): string | null {
  const match = mdx.match(/^title: "((?:[^"\\]|\\.)*)"/m);
  return match ? unescapeYamlDoubleQuoted(match[1]) : null;
}

// Reads the `pubDate:` frontmatter field back out of an already-committed MDX file,
// so a same-title retry can reproduce the ORIGINAL commit's content for comparison
// (buildMdxFileContents always stamps the pubDate it's given, so reproducing with a
// freshly-generated `nowIso` would make even byte-identical prior content look
// "changed" on every single retry).
function extractPubDate(mdx: string): string | null {
  const match = mdx.match(/^pubDate: (\S+)$/m);
  return match ? match[1] : null;
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

      const categoriesJson = await getFileContent(github, 'src/content/categories.json');
      if (categoriesJson === null) throw new Error('src/content/categories.json not found in target repo');
      const category = resolveCategorySlug(fragment.categoryRaw, parseCategorySlugs(categoriesJson));
      const url = `${siteBaseUrl.replace(/\/$/, '')}/${category.slug}/${slug}/`;

      const existing = await getFileContentWithSha(github, relativePath);
      let commitSha: string;
      if (existing === null) {
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
        commitSha = (await createFile(github, relativePath, mdx, `Add blog post: ${fragment.title}`)).commitSha;
      } else if (extractFrontmatterTitle(existing.content) === fragment.title) {
        // Same title at this path — at least a prior attempt at this same post. That
        // attempt's committed content might still be exactly what's currently approved
        // (its deploy verification just didn't conclude last tick, or failed for a
        // reason unrelated to content) — or the approved content might have changed
        // since then (edited + re-approved after a failed/incomplete deploy). Those two
        // cases must NOT be treated the same: reusing the old commit's sha for the
        // latter would report the OLD content's deploy as this publish's outcome,
        // marking the item "published" while the newly approved version was never
        // actually committed (this is what silently shipped a pre-edit version of a
        // post while the dashboard showed the edited/approved one as live).
        const existingPubDate = extractPubDate(existing.content);
        const reproducedMdx = buildMdxFileContents(
          {
            title: fragment.title,
            description: fragment.metaDescription,
            categorySlug: category.slug,
            tags: [],
            pubDateIso: existingPubDate ? `${existingPubDate}T00:00:00.000Z` : nowIso,
            authorName: DEFAULT_AUTHOR_NAME,
            authorBio: DEFAULT_AUTHOR_BIO,
          },
          fragment.bodyMdx,
        );

        if (reproducedMdx === existing.content) {
          // Unchanged since the earlier attempt — safe to just re-check that commit's
          // deploy status instead of erroring or double-committing.
          const sha = await getLatestCommitShaForPath(github, relativePath);
          if (sha === null) throw new Error(`${relativePath} exists but has no commit history — unexpected GitHub state`);
          commitSha = sha;
        } else {
          // The approved content changed since the earlier attempt — commit the update
          // so the version that goes live is the one actually approved now.
          const updatedMdx = buildMdxFileContents(
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
          commitSha = (
            await updateFile(github, relativePath, updatedMdx, `Update blog post: ${fragment.title}`, existing.sha)
          ).commitSha;
        }
      } else {
        throw new Error(`${relativePath} already exists in the repo with a different title — refusing to overwrite it.`);
      }

      // A green commit only means the MDX landed in git — the site's own Deploy
      // workflow (lint -> build -> Cloudflare deploy) still has to pass before the
      // post is reachable at `url`. Spec 15.4: never claim published, or record a
      // URL, unless the connector confirms it.
      const runOutcome = await waitForWorkflowRun(github, commitSha, {
        timeoutMs: DEPLOY_WAIT_TIMEOUT_MS,
        intervalMs: DEPLOY_POLL_INTERVAL_MS,
      });

      if (runOutcome === 'timeout' || runOutcome.conclusion !== 'success') {
        const detail =
          runOutcome === 'timeout'
            ? `Deploy workflow for commit ${commitSha} had not completed after ${DEPLOY_WAIT_TIMEOUT_MS / 1000}s — will re-check next tick.`
            : `Deploy workflow for commit ${commitSha} concluded "${runOutcome.conclusion}" — post is NOT live.`;
        const runUrl = runOutcome === 'timeout' ? null : runOutcome.htmlUrl;

        await supabase.from('publish_events').insert({
          content_id: contentId,
          platform: 'blog',
          version: item.approved_version,
          approved_by: item.approved_by,
          approved_at: item.approved_at,
          platform_post_id: commitSha,
          connector: 'blog-git-github-api',
          result: 'failed',
          error: runUrl ? `${detail} ${runUrl}` : detail,
        });

        // Only alert once per item — otherwise every 1-minute retry re-sends the
        // same email until a human fixes the underlying deploy failure. The insert
        // above already counts as one, so > 1 means an earlier tick already alerted.
        const { count: failureCount } = await supabase
          .from('publish_events')
          .select('id', { count: 'exact', head: true })
          .eq('content_id', contentId)
          .eq('result', 'failed');
        if ((failureCount ?? 1) <= 1) {
          await sendPublishFailureAlert(item.topic, detail, runUrl);
        }

        // Deliberately NOT flipping content_items.status — it stays "scheduled" so
        // the item is neither falsely reported as published nor silently dropped;
        // the next tick retries via the `existing` branch above.
        results.push({ contentId, result: 'failed', detail });
        continue;
      }

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
