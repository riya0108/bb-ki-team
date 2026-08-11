import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runYoutubeViralFinderAgent } from './index.js';
import { SERVER_PATH_ENV_VAR, TSX_CLI_PATH_ENV_VAR } from './mcpClient.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const envPath = path.join(repoRoot, '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const require = createRequire(import.meta.url);
process.env[TSX_CLI_PATH_ENV_VAR] = require.resolve('tsx/cli');
process.env[SERVER_PATH_ENV_VAR] = require.resolve('@ai-company/mcp-search-youtube');

const candidateTopics = process.argv.slice(2);
if (candidateTopics.length === 0) {
  process.stderr.write('Usage: npm run youtube-viral-finder -- "<topic>" ["<topic 2>" ...]\n');
  process.exit(1);
}

const output = await runYoutubeViralFinderAgent({ candidateTopics, blogCandidates: [] });
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
