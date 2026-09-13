import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev-only proxy to apps/api (default port 4000, see packages/core/src/env.ts) so the
// browser never needs CORS: the dashboard calls same-origin '/api/...' paths and Vite
// forwards them. This is an internal operator tool with no production deploy yet
// (CLAUDE.md: dashboard is Phase 3, still being built) — no proxy equivalent exists
// outside `npm run dev`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
