import { fileURLToPath } from 'node:url';

import { createBufferApiClient } from './bufferApiClient.js';
import { loadBufferAccessTokenFromEnv } from './envCredentials.js';

// Read-only connection check for `npm run buffer:verify` — confirms BUFFER_ACCESS_TOKEN
// authenticates and lists every connected channel, so the right BUFFER_CHANNEL_ID (the
// X/Twitter account being automated) can be picked before it's set. Never publishes
// anything. Runs before BUFFER_CHANNEL_ID exists, so it only requires the token.
async function main(): Promise<void> {
  const accessToken = loadBufferAccessTokenFromEnv(process.env);
  const client = createBufferApiClient({ accessToken, channelId: '' });
  const channels = await client.listChannels();

  if (channels.length === 0) {
    // eslint-disable-next-line no-console -- CLI entrypoint output, not library code
    console.log('Connected to Buffer, but no channels are linked to this account yet.');
    return;
  }

  // eslint-disable-next-line no-console -- CLI entrypoint output, not library code
  console.log('Connected to Buffer. Linked channels:');
  for (const channel of channels) {
    const marker = channel.id === process.env.BUFFER_CHANNEL_ID ? ' <- BUFFER_CHANNEL_ID' : '';
    // eslint-disable-next-line no-console -- CLI entrypoint output, not library code
    console.log(`  ${channel.service}\t${channel.displayName}\tid=${channel.id}${marker}`);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
