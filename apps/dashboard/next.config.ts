import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// next.config.ts is loaded directly by the Next CLI (not bundled), so
// import.meta.url / require.resolve reliably reflect this file's real
// location and real node_modules — unlike application code, which gets
// relocated (and has its require.resolve calls statically traced) by the
// bundler.
const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(here, '../../.env');
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

// Must match the env var names read in packages/agents/research/src/mcpClient.ts.
const require = createRequire(import.meta.url);
process.env.RESEARCH_AGENT_TSX_CLI_PATH = require.resolve('tsx/cli');
process.env.RESEARCH_AGENT_SEARCH_SERVERS_JSON = JSON.stringify({
  wikipedia: require.resolve('@ai-company/mcp-search-wikipedia'),
  news: require.resolve('@ai-company/mcp-search-news'),
  youtube: require.resolve('@ai-company/mcp-search-youtube'),
});

interface WebpackConfigWithResolve {
  resolve: { extensionAlias?: Record<string, string[]> };
}

const nextConfig: NextConfig = {
  transpilePackages: ['@ai-company/agent-research', '@ai-company/shared-types', '@ai-company/core'],
  // The workspace packages use Node ESM-style relative imports (`./x.js`
  // pointing at sibling `.ts` files) so they run directly under tsx/Node.
  // webpack needs to be told to resolve those `.js` specifiers against the
  // `.ts` source when bundling them for the dashboard.
  webpack(config: WebpackConfigWithResolve) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
