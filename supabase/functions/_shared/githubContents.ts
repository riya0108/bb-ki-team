// Stateless replacement for packages/mcp-servers/blog-git/src/git.ts's local clone +
// commit + push, using GitHub's Contents API over HTTPS instead — required because an
// Edge Function invocation has no persistent local git checkout to operate on. Each
// call is a single atomic commit made server-side by GitHub, so there's no
// pull/push/reset-on-failure dance to replicate: a create either lands as one commit
// or the request fails outright, nothing to roll back.

export class GitHubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

export interface GitHubRepoConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

function apiBase(config: GitHubRepoConfig, path: string): string {
  return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
}

function authHeaders(config: GitHubRepoConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Returns the decoded text content, or null if the path doesn't exist on the target
// branch (a 404 is the expected/normal case here, not an error — every publish checks
// this first to refuse overwriting an existing post, mirroring server.ts's
// `fileExists` guard).
export async function getFileContent(config: GitHubRepoConfig, path: string): Promise<string | null> {
  const url = `${apiBase(config, path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, { headers: authHeaders(config) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new GitHubApiError(response.status, `GET ${path} failed: HTTP ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { content: string; encoding: string };
  if (body.encoding !== 'base64') {
    throw new GitHubApiError(response.status, `GET ${path} returned unexpected encoding "${body.encoding}"`);
  }
  const bytes = Uint8Array.from(atob(body.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// Creates a new file in a single commit. Only for NEW files (no `sha` passed) — an
// existing file at this path fails the create with a 422, which is exactly the
// "refuse to overwrite" behavior server.ts's fileExists check enforced locally.
export async function createFile(
  config: GitHubRepoConfig,
  path: string,
  content: string,
  message: string,
): Promise<{ commitSha: string }> {
  const url = apiBase(config, path);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
      branch: config.branch,
    }),
  });
  if (!response.ok) {
    throw new GitHubApiError(response.status, `PUT ${path} failed: HTTP ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { commit: { sha: string } };
  return { commitSha: body.commit.sha };
}

// Finds the most recent commit SHA touching `path` on `config.branch`. Used to
// re-locate a prior attempt's commit when the MDX file already exists — so a retry
// after a not-yet-concluded or failed deploy re-checks that same commit's workflow
// status instead of erroring on "file already exists" or attempting a duplicate PUT.
export async function getLatestCommitShaForPath(config: GitHubRepoConfig, path: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(config.branch)}&per_page=1`;
  const response = await fetch(url, { headers: authHeaders(config) });
  if (!response.ok) {
    throw new GitHubApiError(
      response.status,
      `GET commits for ${path} failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { sha: string }[];
  return body[0]?.sha ?? null;
}

export interface WorkflowRunOutcome {
  conclusion: string;
  htmlUrl: string;
}

// Polls GitHub Actions for the run triggered by `commitSha` until it completes, or
// `timeoutMs` elapses. A successful `createFile`/`PUT` only means the MDX landed in
// git — the site repo's own Deploy workflow (lint -> build -> Cloudflare deploy)
// still has to pass before the post is reachable at its computed URL. Spec 15.4:
// "never claim a post was published unless the connector confirms it" — this is
// that confirmation step; without it, the caller would be reporting a git commit as
// a live publish.
export async function waitForWorkflowRun(
  config: GitHubRepoConfig,
  commitSha: string,
  options: { timeoutMs: number; intervalMs: number },
): Promise<WorkflowRunOutcome | 'timeout'> {
  const deadline = Date.now() + options.timeoutMs;
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs?head_sha=${encodeURIComponent(commitSha)}&per_page=5`;

  while (Date.now() < deadline) {
    const response = await fetch(url, { headers: authHeaders(config) });
    if (response.ok) {
      const body = (await response.json()) as {
        workflow_runs: { status: string; conclusion: string | null; html_url: string }[];
      };
      const run = body.workflow_runs[0];
      if (run && run.status === 'completed' && run.conclusion) {
        return { conclusion: run.conclusion, htmlUrl: run.html_url };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  return 'timeout';
}
