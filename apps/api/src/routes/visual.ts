import { randomUUID } from 'node:crypto';

import { getLatestVisualAssetForContent } from '@bb/db';
import { ingestManualVisualAsset, prepareVisualBrief, runVisualStage } from '@bb/visual-agent';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

// BB Visual Agent's on-demand HTTP surface. Platform-agnostic (mirrors
// routes/content.ts) — every head agent's content item can request a visual
// through the same endpoint regardless of which platform created it. Gated on
// BB_VISUAL_AGENT_ENABLED so the existing text-only workflow is completely
// unaffected when the flag is off (BB-Visual-Agent-Skill's integration contract).
export function createVisualRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/:contentId/generate', async (req, res) => {
    if (!deps.env.visualAgentEnabled) {
      res.status(403).json({
        error: 'VisualAgentDisabled',
        message: 'Set BB_VISUAL_AGENT_ENABLED=true to use the visual stage.',
      });
      return;
    }
    const runId = randomUUID();
    const asset = await runVisualStage({
      contentId: req.params.contentId ?? '',
      pool: deps.pool,
      llm: deps.llm,
      imageGen: deps.imageGen,
      runId,
    });
    res.status(200).json({ runId, asset });
  });

  // Manual/browser-driven path (no billed image provider required): step 1 —
  // decide + brief, return the exact prompt for a human/Claude to paste into a
  // browser session (ChatGPT, Gemini web, etc — see .agents/skills/bb-visual-agent).
  router.post('/:contentId/prepare', async (req, res) => {
    if (!deps.env.visualAgentEnabled) {
      res.status(403).json({
        error: 'VisualAgentDisabled',
        message: 'Set BB_VISUAL_AGENT_ENABLED=true to use the visual stage.',
      });
      return;
    }
    const runId = randomUUID();
    const result = await prepareVisualBrief({
      contentId: req.params.contentId ?? '',
      pool: deps.pool,
      llm: deps.llm,
      runId,
    });
    if (result.kind === 'terminal') {
      res.status(200).json({ runId, terminal: true, asset: result.asset });
      return;
    }
    res.status(200).json({
      runId,
      terminal: false,
      visualId: result.visualId,
      prompt: result.prompt,
      negativePrompt: result.negativePrompt,
      aspectRatio: result.aspectRatio,
    });
  });

  // Manual/browser-driven path, step 2 — finish a GENERATION_PENDING brief once a
  // human/Claude has generated the image and downloaded it, base64-encoded here.
  const IngestSchema = z.object({
    visualId: z.string().uuid(),
    base64Data: z.string().min(1),
    mimeType: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
  });
  router.post('/:contentId/ingest', async (req, res) => {
    if (!deps.env.visualAgentEnabled) {
      res.status(403).json({
        error: 'VisualAgentDisabled',
        message: 'Set BB_VISUAL_AGENT_ENABLED=true to use the visual stage.',
      });
      return;
    }
    const body = parseWith(IngestSchema, req.body);
    const runId = randomUUID();
    const asset = await ingestManualVisualAsset({
      contentId: req.params.contentId ?? '',
      visualId: body.visualId,
      pool: deps.pool,
      llm: deps.llm,
      imageGen: deps.imageGen,
      runId,
      base64Data: body.base64Data,
      mimeType: body.mimeType,
      provider: body.provider,
      model: body.model,
    });
    res.status(200).json({ runId, asset });
  });

  router.get('/:contentId', async (req, res) => {
    const asset = await getLatestVisualAssetForContent(deps.pool, req.params.contentId ?? '');
    res.status(200).json({ asset });
  });

  return router;
}
