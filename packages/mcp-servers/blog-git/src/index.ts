import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createBlogGitMcpServer } from './server.js';

export { createBlogGitMcpServer } from './server.js';
export type { BlogGitMcpServerDeps } from './server.js';
export { loadCategorySlugs, resolveCategorySlug } from './categories.js';
export { buildMdxFileContents } from './mdxFile.js';
export type { BlogFrontmatter } from './mdxFile.js';

function loadDepsFromEnv(env: NodeJS.ProcessEnv): { repoPath: string; branch: string; siteBaseUrl: string } {
  const repoPath = env.BLOG_REPO_PATH;
  if (!repoPath) throw new Error('BLOG_REPO_PATH is required to start the blog-git MCP server');
  return {
    repoPath,
    branch: env.BLOG_REPO_BRANCH ?? 'master',
    siteBaseUrl: env.BLOG_SITE_BASE_URL ?? 'https://bullorbear.in',
  };
}

async function main(): Promise<void> {
  const server = createBlogGitMcpServer(loadDepsFromEnv(process.env));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
