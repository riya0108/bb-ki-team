import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResearchAgent } from './index.js';
import { TSX_CLI_PATH_ENV_VAR, SEARCH_SERVERS_ENV_VAR } from './mcpClient.js';

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
});

const query = process.argv.slice(2).join(' ').trim();

if (!query) {
  process.stderr.write('Usage: npm run research -- "<research query>"\n');
  process.exit(1);
}

const output = await runResearchAgent(query);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
