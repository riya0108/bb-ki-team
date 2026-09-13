import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createYoutubeTranscriptMcpServer } from './server.js';

export { createYoutubeTranscriptMcpServer } from './server.js';
export { fetchYoutubeTranscript } from './youtubeTranscript.js';
export type { TranscriptOutcome } from './youtubeTranscript.js';
export { extractYoutubeVideoId } from './videoId.js';
export { parseTimedTextXml } from './captionXml.js';

async function main(): Promise<void> {
  const server = createYoutubeTranscriptMcpServer();
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
