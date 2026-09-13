import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createFetchMcpServer } from './server.js';

export { createFetchMcpServer } from './server.js';
export { fetchAndExtract } from './fetchUrl.js';
export type { FetchOutcome } from './fetchUrl.js';
export { extractReadableTextFromHtml, extractTextFromPdf } from './extract.js';

async function main(): Promise<void> {
  const server = createFetchMcpServer();
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
