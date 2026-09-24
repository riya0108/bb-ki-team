import { randomUUID } from 'node:crypto';

import {
  createReferenceAsset,
  deactivateReferenceAsset,
  listReferenceAssets,
} from '@bb/db';
import { VisualReferenceKindSchema } from '@bb/shared-types';
import type { VisualReferenceAsset } from '@bb/shared-types';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// Persistent reference images for the BB Visual Agent's blog thumbnail generation
// (packages/agents/visual): a recurring character's photos (for identity
// consistency across posts) and thumbnail style examples (for consistent art
// direction). Gated on the same flag as /visual — this is purely an input to that
// stage, meaningless with it off. Reuses ImageGenTool.storeVisualAsset/signAsset
// (image-gen MCP) rather than a new storage path.
export function createReferencesRouter(deps: AppDeps): Router {
  const router = Router();

  const gate = (req: Request, res: Response): boolean => {
    if (!deps.env.visualAgentEnabled) {
      res.status(403).json({
        error: 'VisualAgentDisabled',
        message: 'Set BB_VISUAL_AGENT_ENABLED=true to use the visual reference library.',
      });
      return false;
    }
    return true;
  };

  const CreateSchema = z.object({
    platform: z.string().min(1),
    kind: VisualReferenceKindSchema,
    label: z.string().min(1).nullable().optional(),
    base64Data: z.string().min(1),
    mimeType: z.string().min(1),
  });

  router.post('/', async (req, res) => {
    if (!gate(req, res)) return;
    const body = parseWith(CreateSchema, req.body);
    const id = randomUUID();
    const extension = EXTENSION_BY_MIME[body.mimeType] ?? 'png';
    const path = `references/${body.platform}/${body.kind}/${id}.${extension}`;

    const stored = await deps.imageGen.storeVisualAsset({
      path,
      base64Data: body.base64Data,
      mimeType: body.mimeType,
    });
    const record = await createReferenceAsset(deps.pool, {
      platform: body.platform,
      kind: body.kind,
      label: body.label ?? null,
      assetPath: stored.assetPath,
      mimeType: body.mimeType,
    });

    const reference: VisualReferenceAsset = { ...record, assetUrl: stored.assetUrl };
    res.status(200).json({ reference });
  });

  const ListQuerySchema = z.object({
    platform: z.string().min(1),
    kind: VisualReferenceKindSchema.optional(),
  });

  router.get('/', async (req, res) => {
    if (!gate(req, res)) return;
    const query = parseWith(ListQuerySchema, req.query);
    const records = await listReferenceAssets(deps.pool, query.platform, query.kind);
    const references: VisualReferenceAsset[] = await Promise.all(
      records.map(async (record) => {
        const signed = await deps.imageGen.signAsset(record.assetPath);
        return { ...record, assetUrl: signed.assetUrl };
      }),
    );
    res.status(200).json({ references });
  });

  router.delete('/:id', async (req, res) => {
    if (!gate(req, res)) return;
    await deactivateReferenceAsset(deps.pool, req.params.id ?? '');
    res.status(200).json({ ok: true });
  });

  return router;
}
