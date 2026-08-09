import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResearchAgent } from './index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const envPath = path.join(repoRoot, '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const query = process.argv.slice(2).join(' ').trim();

if (!query) {
  process.stderr.write('Usage: npm run research -- "<research query>"\n');
  process.exit(1);
}

const output = await runResearchAgent(query);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
