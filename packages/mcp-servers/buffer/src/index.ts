import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createBufferApiClient } from './bufferApiClient.js';
import { loadBufferCredentialsFromEnv } from './envCredentials.js';
import { createBufferMcpServer } from './server.js';

export { createBufferMcpServer } from './server.js';
export { createBufferApiClient } from './bufferApiClient.js';
export type { BufferApiClient, BufferCredentials, BufferChannel, BufferPost } from './bufferApiClient.js';
export { loadBufferAccessTokenFromEnv, loadBufferCredentialsFromEnv } from './envCredentials.js';
export { waitForSent, BufferPostFailedError, BufferPostTimeoutError } from './postPolling.js';

async function main(): Promise<void> {
  const apiClient = createBufferApiClient(loadBufferCredentialsFromEnv(process.env));
  const server = createBufferMcpServer({ apiClient });
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
