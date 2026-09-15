import type { XCredentials } from './xApiClient.js';

// Shared by index.ts (the MCP server entrypoint) and verify.ts (the standalone
// connection check) so both fail with the same clear message on missing config.
export function loadXCredentialsFromEnv(env: NodeJS.ProcessEnv): XCredentials {
  const apiKey = env.X_API_KEY;
  const apiSecret = env.X_API_SECRET;
  const accessToken = env.X_ACCESS_TOKEN;
  const accessTokenSecret = env.X_ACCESS_TOKEN_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      'X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET must all be set (see .env.example).',
    );
  }
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}
