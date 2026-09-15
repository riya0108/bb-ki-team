import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitCommandError extends Error {
  constructor(
    public readonly args: string[],
    stderr: string,
  ) {
    super(`git ${args.join(' ')} failed: ${stderr.trim() || '(no stderr)'}`);
    this.name = 'GitCommandError';
  }
}

// Every automated commit this connector makes carries its own identity, passed as
// env to this one child process rather than touching the target repo's
// user.name/user.email config (CLAUDE.md's git safety rules: never mutate config
// the human didn't ask for).
const COMMIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Bull or Bear Content Team',
  GIT_AUTHOR_EMAIL: 'content-team@bullorbear.in',
  GIT_COMMITTER_NAME: 'Bull or Bear Content Team',
  GIT_COMMITTER_EMAIL: 'content-team@bullorbear.in',
};

async function git(cwd: string, args: string[], extraEnv?: Record<string, string>): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    return stdout.trim();
  } catch (error) {
    const stderr = typeof (error as { stderr?: unknown }).stderr === 'string' ? (error as { stderr: string }).stderr : '';
    throw new GitCommandError(args, stderr || String(error));
  }
}

export async function isWorkingTreeClean(repoPath: string): Promise<boolean> {
  const status = await git(repoPath, ['status', '--porcelain']);
  return status.length === 0;
}

export async function currentHeadSha(repoPath: string): Promise<string> {
  return git(repoPath, ['rev-parse', 'HEAD']);
}

// ff-only: never auto-merges a diverged branch (CLAUDE.md's git safety rules — no
// destructive/ambiguous history rewriting on a repo this connector doesn't own).
export async function pullFastForwardOnly(repoPath: string, branch: string): Promise<void> {
  await git(repoPath, ['checkout', branch]);
  await git(repoPath, ['pull', '--ff-only', 'origin', branch]);
}

export async function addFile(repoPath: string, relativePath: string): Promise<void> {
  await git(repoPath, ['add', '--', relativePath]);
}

export async function commit(repoPath: string, message: string): Promise<string> {
  await git(repoPath, ['commit', '-m', message], COMMIT_IDENTITY);
  return currentHeadSha(repoPath);
}

export async function push(repoPath: string, branch: string): Promise<void> {
  await git(repoPath, ['push', 'origin', branch]);
}

// Cleanup path when a push (or anything after a local commit) fails — undoes only
// the commit this call just made, never anything that predates it.
export async function resetHardTo(repoPath: string, sha: string): Promise<void> {
  await git(repoPath, ['reset', '--hard', sha]);
}
