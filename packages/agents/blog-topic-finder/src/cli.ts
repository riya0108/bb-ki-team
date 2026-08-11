import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorialCategorySchema } from '@ai-company/shared-types';
import { runBlogTopicFinderAgent } from './index.js';
import {
  ARCHIVE_SERVER_PATH_ENV_VAR,
  SEARCH_SERVERS_ENV_VAR,
  TSX_CLI_PATH_ENV_VAR,
} from './mcpClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const envPath = path.join(repoRoot, '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const require = createRequire(import.meta.url);
process.env[TSX_CLI_PATH_ENV_VAR] = require.resolve('tsx/cli');
process.env[SEARCH_SERVERS_ENV_VAR] = JSON.stringify({
  wikipedia: require.resolve('@ai-company/mcp-search-wikipedia'),
  news: require.resolve('@ai-company/mcp-search-news'),
  youtube: require.resolve('@ai-company/mcp-search-youtube'),
  competitor: require.resolve('@ai-company/mcp-search-competitors'),
  hackernews: require.resolve('@ai-company/mcp-search-hackernews'),
});
process.env[ARCHIVE_SERVER_PATH_ENV_VAR] = require.resolve('@ai-company/mcp-publish-blog-git');

const focusCategoryArg = process.argv[2];
const focusCategory = focusCategoryArg ? EditorialCategorySchema.parse(focusCategoryArg) : undefined;

const output = await runBlogTopicFinderAgent(focusCategory ? { focusCategory } : {});
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
