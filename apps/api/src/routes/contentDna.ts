import { confirmDnaChange, loadCurrentDna } from '@bb/content-dna';
import { listPendingLearningEvents, rejectLearningEvent } from '@bb/db';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

// Surfaces the Learning Loop (spec 16): agents propose Content DNA changes as learning
// events (see packages/agents/linkedin/src/editPost.ts), but a change never takes
// effect until a human confirms it here — never automatic, per spec 3.4.
export function createContentDnaRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const dna = await loadCurrentDna(deps.pool);
    res.status(200).json({ contentDna: dna });
  });

  router.get('/learning-events', async (_req, res) => {
    const events = await listPendingLearningEvents(deps.pool);
    res.status(200).json({ events });
  });

  const ConfirmSchema = z.object({ confirmedBy: z.string().min(1) });
  router.post('/learning-events/:id/confirm', async (req, res) => {
    const body = parseWith(ConfirmSchema, req.body);
    const dna = await confirmDnaChange(deps.pool, req.params.id ?? '', body.confirmedBy);
    res.status(200).json({ contentDna: dna });
  });

  router.post('/learning-events/:id/reject', async (req, res) => {
    await rejectLearningEvent(deps.pool, req.params.id ?? '');
    res.status(200).json({ ok: true });
  });

  return router;
}
