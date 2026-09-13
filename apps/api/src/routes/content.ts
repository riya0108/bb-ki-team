import { ContentStatusSchema } from '@bb/shared-types';
import { ContentItemNotFoundError, getContentItem, listContentItems, recordApproval, reject, requestChanges } from '@bb/workflows';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

const ListQuerySchema = z.object({
  status: ContentStatusSchema.optional(),
  platform: z.string().optional(),
});

// Platform-agnostic — every mode across every head agent ends up as a ContentItem
// going through the same approval state machine (packages/workflows), so this
// lifecycle surface is not LinkedIn-specific even though only LinkedIn is wired up yet.
export function createContentRouter(deps: AppDeps): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const query = parseWith(ListQuerySchema, req.query);
    const items = await listContentItems(deps.pool, {
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.platform !== undefined ? { platform: query.platform } : {}),
    });
    res.status(200).json({ items });
  });

  router.get('/:id', async (req, res) => {
    const id = req.params.id ?? '';
    const item = await getContentItem(deps.pool, id);
    if (!item) throw new ContentItemNotFoundError(id);
    res.status(200).json({ item });
  });

  const ApproveSchema = z.object({ version: z.number().int().positive(), approvedBy: z.string().min(1) });
  router.post('/:id/approve', async (req, res) => {
    const body = parseWith(ApproveSchema, req.body);
    const item = await recordApproval(deps.pool, req.params.id ?? '', body.version, body.approvedBy);
    res.status(200).json({ item });
  });

  const FeedbackSchema = z.object({ feedback: z.string().min(1) });
  router.post('/:id/request-changes', async (req, res) => {
    const body = parseWith(FeedbackSchema, req.body);
    const item = await requestChanges(deps.pool, req.params.id ?? '', body.feedback);
    res.status(200).json({ item });
  });

  const RejectSchema = z.object({ reason: z.string().min(1) });
  router.post('/:id/reject', async (req, res) => {
    const body = parseWith(RejectSchema, req.body);
    const item = await reject(deps.pool, req.params.id ?? '', body.reason);
    res.status(200).json({ item });
  });

  return router;
}
