import cors from 'cors';
import express from 'express';
import type { Express } from 'express';

import { sharedSecretAuth } from './auth.js';
import type { AppDeps } from './deps.js';
import { errorHandler } from './errorHandler.js';
import { createBlogRouter } from './routes/blog.js';
import { createContentRouter } from './routes/content.js';
import { createContentDnaRouter } from './routes/contentDna.js';
import { createInstagramRouter } from './routes/instagram.js';
import { createLinkedinRouter } from './routes/linkedin.js';
import { createSchedulerRouter } from './routes/scheduler.js';
import { createVisualRouter } from './routes/visual.js';
import { createXRouter } from './routes/x.js';
import { createYoutubeShortsRouter } from './routes/youtubeShorts.js';

// Pure function from deps to a listenable app — no process/env/network access of its
// own, so it can be built against fake deps and driven with a real HTTP client in
// tests (CLAUDE.md: every module touching external state must be testable in isolation).
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Browser CORS check runs before the shared-secret check below, and before
  // Express even reaches route handlers for preflight OPTIONS requests — the `cors`
  // package answers those directly. Locked to exactly one origin (not `*`) since
  // this now sits in front of real (if single-operator) data. When unset (local
  // dev), cross-origin requests are denied outright, matching this app's original
  // loopback-only default — local dev never needs it since the Vite proxy makes
  // requests same-origin.
  app.use(cors({ origin: deps.env.corsAllowedOrigin ?? false }));

  // No-op locally (DASHBOARD_SHARED_SECRET unset) — see auth.ts. Applied after
  // /health (which must stay reachable for host health checks without a token) and
  // before every real route.
  app.use(sharedSecretAuth(deps.env.dashboardSharedSecret));

  app.use('/linkedin', createLinkedinRouter(deps));
  app.use('/x', createXRouter(deps));
  app.use('/instagram', createInstagramRouter(deps));
  app.use('/youtube-shorts', createYoutubeShortsRouter(deps));
  app.use('/blog', createBlogRouter(deps));
  app.use('/content', createContentRouter(deps));
  app.use('/content-dna', createContentDnaRouter(deps));
  app.use('/visual', createVisualRouter(deps));
  app.use('/internal/scheduler', createSchedulerRouter(deps));

  app.use(errorHandler(deps.logger));

  return app;
}
