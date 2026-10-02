// Stateless replacement for packages/mcp-servers/blog-git/src/git.ts's local clone +
// commit + push, using GitHub's Contents API over HTTPS instead — required because an
// Edge Function invocation has no persistent local git checkout to operate on.
// commitFiles makes a single atomic commit server-side by GitHub, so there's no
// pull/push/reset-on-failure dance to replicate: the branch ref only moves once the
// whole commit exists, or the request fails outright, nothing to roll back.

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

export interface RepoFileWrite {
  path: string;
  // Already-base64-encoded bytes — text callers encode their UTF-8 themselves, so
  // binary content (an image) is never round-tripped through a string decode.
  base64Content: string;
}

async function gitApi<T>(config: GitHubRepoConfig, method: string, path: string, body?: unknown): Promise<T> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/${path}`;
  const response = await fetch(url, {
    method,
    headers: { ...authHeaders(config), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new GitHubApiError(response.status, `${method} git/${path} failed: HTTP ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

// Writes every file in `files` (create or replace) as ONE commit on `config.branch`,
// via the Git Data API (blobs -> tree -> commit -> ref). One commit per publish is
// the point: the Contents API makes one commit per file, and each commit triggers
// its own Deploy workflow in the site repo — a cover-image commit's deploy (built
// without the post) could finish after the post's deploy and overwrite it, leaving
// the post 404 while both runs report success. The final ref update is a
// non-force fast-forward, so if the branch moved since we read it the call fails
// (422) instead of silently discarding someone else's commit.
export async function commitFiles(
  config: GitHubRepoConfig,
  files: RepoFileWrite[],
  message: string,
): Promise<{ commitSha: string }> {
  if (files.length === 0) throw new Error('commitFiles called with no files');
  const ref = await gitApi<{ object: { sha: string } }>(config, 'GET', `ref/heads/${encodeURIComponent(config.branch)}`);
  const parentSha = ref.object.sha;
  const parent = await gitApi<{ tree: { sha: string } }>(config, 'GET', `commits/${parentSha}`);

  const treeEntries = [];
  for (const file of files) {
    const blob = await gitApi<{ sha: string }>(config, 'POST', 'blobs', {
      content: file.base64Content,
      encoding: 'base64',
    });
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const tree = await gitApi<{ sha: string }>(config, 'POST', 'trees', { base_tree: parent.tree.sha, tree: treeEntries });
  const commit = await gitApi<{ sha: string }>(config, 'POST', 'commits', {
    message,
    tree: tree.sha,
    parents: [parentSha],
  });
  await gitApi(config, 'PATCH', `refs/heads/${encodeURIComponent(config.branch)}`, { sha: commit.sha, force: false });
  return { commitSha: commit.sha };
}

// Same file/path and decoded content as getFileContent, plus the file's blob `sha`.
export async function getFileContentWithSha(
  config: GitHubRepoConfig,
  path: string,
): Promise<{ content: string; sha: string } | null> {
  const url = `${apiBase(config, path)}?ref=${encodeURIComponent(config.branch)}`;
  const response = await fetch(url, { headers: authHeaders(config) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new GitHubApiError(response.status, `GET ${path} failed: HTTP ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { content: string; encoding: string; sha: string };
  if (body.encoding !== 'base64') {
    throw new GitHubApiError(response.status, `GET ${path} returned unexpected encoding "${body.encoding}"`);
  }
  const bytes = Uint8Array.from(atob(body.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  return { content: new TextDecoder().decode(bytes), sha: body.sha };
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
// `timeoutMs` elapses. A successful commitFiles only means the MDX landed in
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
      const body = (await response.json()) as { workflow_runs: WorkflowRun[] };
      const run = body.workflow_runs[0];
      if (run && run.status === 'completed' && run.conclusion) {
        if (run.conclusion !== 'cancelled') return { conclusion: run.conclusion, htmlUrl: run.html_url };
        // The site's Deploy workflow cancels an in-progress run when a newer push
        // arrives (concurrency: cancel-in-progress). That newer run deploys a build
        // that still contains this commit, so its outcome is this commit's outcome.
        const successor = await findSupersedingRun(config, commitSha);
        if (successor === null) return { conclusion: run.conclusion, htmlUrl: run.html_url };
        if (successor.status === 'completed' && successor.conclusion) {
          return { conclusion: successor.conclusion, htmlUrl: successor.html_url };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  return 'timeout';
}

interface WorkflowRun {
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

// The newest push-triggered run on the branch, if its commit is a descendant of
// `commitSha` (i.e. its build includes this commit); null otherwise.
async function findSupersedingRun(config: GitHubRepoConfig, commitSha: string): Promise<WorkflowRun | null> {
  const repoBase = `https://api.github.com/repos/${config.owner}/${config.repo}`;
  const runsResponse = await fetch(
    `${repoBase}/actions/runs?branch=${encodeURIComponent(config.branch)}&event=push&per_page=1`,
    { headers: authHeaders(config) },
  );
  if (!runsResponse.ok) return null;
  const latest = ((await runsResponse.json()) as { workflow_runs: WorkflowRun[] }).workflow_runs[0];
  if (!latest || latest.head_sha === commitSha) return null;

  const compareResponse = await fetch(`${repoBase}/compare/${commitSha}...${latest.head_sha}`, {
    headers: authHeaders(config),
  });
  if (!compareResponse.ok) return null;
  const { status } = (await compareResponse.json()) as { status: string };
  return status === 'ahead' ? latest : null;
}
