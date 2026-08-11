import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrendResearchAgent } from './index.js';
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
  trends: require.resolve('@ai-company/mcp-search-trends'),
  competitor: require.resolve('@ai-company/mcp-search-competitors'),
});

const topic = process.argv.slice(2).join(' ').trim();

if (!topic) {
  process.stderr.write('Usage: npm run trend-research -- "<topic/niche>"\n');
  process.exit(1);
}

const output = await runTrendResearchAgent(topic);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
