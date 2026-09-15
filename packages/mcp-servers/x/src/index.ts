import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadXCredentialsFromEnv } from './envCredentials.js';
import { createXMcpServer } from './server.js';
import { createXApiClient } from './xApiClient.js';

export { createXMcpServer } from './server.js';
export { postThread, EmptyThreadError } from './threadPosting.js';
export { buildPostUrl } from './postUrl.js';
export { createXApiClient } from './xApiClient.js';
export type { XApiClient, XCredentials, PostedTweet } from './xApiClient.js';
export { loadXCredentialsFromEnv } from './envCredentials.js';

async function main(): Promise<void> {
  const apiClient = createXApiClient(loadXCredentialsFromEnv(process.env));
  const server = createXMcpServer({ apiClient });
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
