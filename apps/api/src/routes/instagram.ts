import { randomUUID } from 'node:crypto';

import { runInstagramHead } from '@bb/agent-instagram';
import { InstagramFormatSchema } from '@bb/shared-types';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

// No fetchTool-backed repurpose route yet (spec section 7 doesn't define a distinct
// modes list the way LinkedIn/X do — the head workflow always starts from an
// "approved source/topic"). Callers that need to repurpose a URL should fetch it
// themselves (e.g. via /linkedin/repurpose's fetch step) and pass the text in here.
const DraftSchema = z.object({
  topic: z.string().min(1),
  angle: z.string().min(1),
  coreClaim: z.string().nullable().optional(),
  sourceReferences: z.array(z.string()).optional(),
  sourceTexts: z.array(z.string()).optional(),
  // Spec 7.1: "The user may override the routing decision by explicitly naming the format."
  format: InstagramFormatSchema.optional(),
});

export function createInstagramRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/draft', async (req, res) => {
    const body = parseWith(DraftSchema, req.body);
    const runId = randomUUID();
    const pkg = await runInstagramHead({
      pool: deps.pool,
      llm: deps.llm,
      topic: body.topic,
      angle: body.angle,
      coreClaim: body.coreClaim ?? null,
      ...(body.sourceReferences !== undefined ? { sourceReferences: body.sourceReferences } : {}),
      ...(body.sourceTexts !== undefined ? { sourceTexts: body.sourceTexts } : {}),
      ...(body.format !== undefined ? { format: body.format } : {}),
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  return router;
}
