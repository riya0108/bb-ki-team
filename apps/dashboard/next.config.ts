import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// next.config.ts is loaded directly by the Next CLI (not bundled), so
// import.meta.url reliably reflects this file's real location — unlike
// application code, which gets relocated by the bundler.
const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(here, '../../.env');
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

interface WebpackConfigWithResolve {
  resolve: { extensionAlias?: Record<string, string[]> };
}

const nextConfig: NextConfig = {
  // The dashboard no longer imports agent packages directly (only
  // apps/worker does, as a plain never-bundled tsx process) — it talks to
  // apps/api over HTTP and reads Postgres directly via @ai-company/db.
  transpilePackages: ['@ai-company/db', '@ai-company/shared-types', '@ai-company/core'],
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
