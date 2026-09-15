import { fileURLToPath } from 'node:url';

import { loadXCredentialsFromEnv } from './envCredentials.js';
import { createXApiClient } from './xApiClient.js';

// Read-only connection check for `npm run x:verify` — confirms the four X_*
// credentials in .env actually authenticate, without publishing anything.
async function main(): Promise<void> {
  const client = createXApiClient(loadXCredentialsFromEnv(process.env));
  const username = await client.getConnectedUsername();
  // eslint-disable-next-line no-console -- CLI entrypoint output, not library code
  console.log(`Connected to X as @${username}. The publish connector is ready.`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
