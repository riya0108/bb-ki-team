import type { BufferCredentials } from './bufferApiClient.js';

// Shared by index.ts (the MCP server entrypoint, which needs a channel to post to)
// and verify.ts (the standalone channel-discovery check, which only needs the token
// to list channels before a channel id is even chosen) — verify.ts calls
// loadBufferAccessTokenFromEnv directly instead of this, since it must work before
// BUFFER_CHANNEL_ID is set.
export function loadBufferAccessTokenFromEnv(env: NodeJS.ProcessEnv): string {
  const accessToken = env.BUFFER_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('BUFFER_ACCESS_TOKEN must be set (see .env.example).');
  }
  return accessToken;
}

export function loadBufferCredentialsFromEnv(env: NodeJS.ProcessEnv): BufferCredentials {
  const accessToken = loadBufferAccessTokenFromEnv(env);
  const channelId = env.BUFFER_CHANNEL_ID;
  if (!channelId) {
    throw new Error(
      'BUFFER_CHANNEL_ID must be set (see .env.example — run `npm run buffer:verify` to list channel ids).',
    );
  }
  return { accessToken, channelId };
}
