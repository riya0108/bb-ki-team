import express from 'express';
import type { Express } from 'express';

import type { AppDeps } from './deps.js';
import { errorHandler } from './errorHandler.js';
import { createContentRouter } from './routes/content.js';
import { createContentDnaRouter } from './routes/contentDna.js';
import { createLinkedinRouter } from './routes/linkedin.js';
import { createXRouter } from './routes/x.js';

// Pure function from deps to a listenable app — no process/env/network access of its
// own, so it can be built against fake deps and driven with a real HTTP client in
// tests (CLAUDE.md: every module touching external state must be testable in isolation).
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/linkedin', createLinkedinRouter(deps));
  app.use('/x', createXRouter(deps));
  app.use('/content', createContentRouter(deps));
  app.use('/content-dna', createContentDnaRouter(deps));

  app.use(errorHandler(deps.logger));

  return app;
}
