import { randomUUID } from 'node:crypto';

import { loadCurrentDna } from '@bb/content-dna';
import { listPublishEventsForContent, listRevisionsForContent } from '@bb/db';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import { ContentStatusSchema } from '@bb/shared-types';
import {
  addRevision,
  cancelSchedule,
  ContentItemNotFoundError,
  getContentItem,
  listContentItems,
  recordApproval,
  reject,
  requestChanges,
  requestPublish,
  requestSchedule,
  recordQaResult,
  rescheduleContent,
} from '@bb/workflows';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

// Human-readable platform labels the QA rubric checks expect (same labels each head
// agent passes to runQaGate itself).
const QA_PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  youtube_shorts: 'YouTube Shorts',
  blog: 'Blog',
};

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

  // No real connectors are registered yet (deps.publishConnectors/scheduleConnectors
  // are empty until a Phase 3 platform integration is built) — every call here
  // records an honest failed PUBLISH_EVENT rather than pretending to publish
  // (CLAUDE.md: never fabricate success; spec 15.4).
  router.post('/:id/publish', async (req, res) => {
    const { item, event } = await requestPublish(deps.pool, req.params.id ?? '', deps.publishConnectors);
    res.status(200).json({ item, event });
  });

  const ScheduleSchema = z.object({ scheduledFor: z.string().datetime() });
  router.post('/:id/schedule', async (req, res) => {
    const body = parseWith(ScheduleSchema, req.body);
    const { item, event } = await requestSchedule(
      deps.pool,
      req.params.id ?? '',
      new Date(body.scheduledFor),
      deps.scheduleConnectors,
    );
    res.status(200).json({ item, event });
  });

  // Modify (not cancel) the target time of a schedule that's already pending —
  // distinct from the initial POST /:id/schedule above, which requires status
  // 'approved'; this requires 'scheduled' (see rescheduleContent).
  router.post('/:id/schedule/modify', async (req, res) => {
    const body = parseWith(ScheduleSchema, req.body);
    const { item, event } = await rescheduleContent(
      deps.pool,
      req.params.id ?? '',
      new Date(body.scheduledFor),
      deps.scheduleConnectors,
    );
    res.status(200).json({ item, event });
  });

  router.post('/:id/schedule/cancel', async (req, res) => {
    const { item, event } = await cancelSchedule(deps.pool, req.params.id ?? '');
    res.status(200).json({ item, event });
  });

  router.get('/:id/revisions', async (req, res) => {
    const revisions = await listRevisionsForContent(deps.pool, req.params.id ?? '');
    res.status(200).json({ revisions });
  });

  // Direct draft-canvas text edits (dashboard: "click into the exact text, edit it,
  // save a revision" — spec 17). Distinct from the LLM-mediated /edit endpoints each
  // agent exposes (natural-language instruction -> new draft): this writes the
  // user's exact text as a new revision. addRevision already enforces spec 15.2's
  // re-review invariant (an approved item edited this way returns to in_review).
  //
  // `threadPosts` is optional and X-specific (spec 6.1 thread mode): when the
  // dashboard's X editor is used to split a too-long post into multiple tweets, it
  // sends the full ordered array here so the saved package.mode/threadPosts stay in
  // sync with tweetsForItem (packages/mcp-client/src/xClient.ts) — otherwise a
  // manual edit that grows past X's 280-char limit would only be caught at publish
  // time instead of being fixable as a thread up front.
  const ReviseSchema = z.object({
    newText: z.string().min(1),
    changedById: z.string().min(1),
    threadPosts: z.array(z.string().min(1)).nullable().optional(),
  });
  router.post('/:id/revisions', async (req, res) => {
    const body = parseWith(ReviseSchema, req.body);
    let packagePatch: Record<string, unknown> | undefined;
    if (body.threadPosts !== undefined) {
      const current = await getContentItem(deps.pool, req.params.id ?? '');
      if (!current) throw new ContentItemNotFoundError(req.params.id ?? '');
      const isThread = body.threadPosts !== null && body.threadPosts.length > 1;
      packagePatch = {
        ...(current.package ?? {}),
        mode: isThread ? 'thread' : 'single',
        threadPosts: isThread ? body.threadPosts : null,
      };
    }
    const { item, revision } = await addRevision(deps.pool, req.params.id ?? '', {
      changeType: 'user_edit',
      newText: body.newText,
      changedBy: 'user',
      changedById: body.changedById,
      ...(packagePatch !== undefined ? { package: packagePatch } : {}),
    });

    // Every new version gets its own QA pass, same invariant as the agents' LLM edit
    // modes — otherwise a manual edit leaves the new version with no QA result, and
    // anything gated on the truth layer (e.g. the Visual Agent's
    // VISUAL_BLOCKED_MISSING_TRUTH_LAYER check) stays blocked for it.
    const runId = randomUUID();
    const dna = await loadCurrentDna(deps.pool);
    const qa = await runQaGate({
      finalPost: item.currentText,
      sourceReferences: item.sourceUrls,
      sourceTexts: [],
      contentDna: dna,
      status: item.status,
      llm: deps.llm,
      runId,
      stepId: `qa-${item.id}-v${item.currentVersion}`,
      platform: QA_PLATFORM_LABELS[item.platform] ?? item.platform,
    }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
    await recordQaResult(deps.pool, item.id, item.currentVersion, qa);

    res.status(201).json({ item, revision });
  });

  router.get('/:id/publish-events', async (req, res) => {
    const events = await listPublishEventsForContent(deps.pool, req.params.id ?? '');
    res.status(200).json({ events });
  });

  return router;
}
