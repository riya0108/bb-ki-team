import { randomUUID } from 'node:crypto';

import {
  aggregateStyleProfile,
  handleBlogChatMessage,
  ingestStyleReference,
  MEMORY_SCOPE,
  recordEditorialFeedback,
  runBlogArticle,
  runBlogArticleFromSource,
  setEditorialMemoryStatus,
} from '@bb/agent-blog';
import {
  createChatSession,
  deactivateStyleSample,
  getOrCreateLatestChatSession,
  listActiveStyleSamples,
  listChatMessages,
  listLiveEditorialMemories,
} from '@bb/db';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

const BlogSourceSchema = z.union([
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('text'), label: z.string().min(1), text: z.string().min(1) }),
]);

export function createBlogRouter(deps: AppDeps): Router {
  const router = Router();

  const DraftSchema = z.object({
    topic: z.string().min(1),
    // spec 12.2's blog modes, e.g. "Explainer", "How-to guide", "Comparison/review".
    articleType: z.string().min(1).default('New article'),
    constraints: z.string().nullable().optional(),
    sourceReferences: z.array(z.string()).optional(),
    sourceTexts: z.array(z.string()).optional(),
    sampleArticleTexts: z.array(z.string()).optional(),
  });
  router.post('/draft', async (req, res) => {
    const body = parseWith(DraftSchema, req.body);
    const runId = randomUUID();
    const pkg = await runBlogArticle({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      logger: deps.logger,
      topic: body.topic,
      articleType: body.articleType,
      constraints: body.constraints ?? null,
      ...(body.sourceReferences !== undefined ? { sourceReferences: body.sourceReferences } : {}),
      ...(body.sourceTexts !== undefined ? { sourceTexts: body.sourceTexts } : {}),
      ...(body.sampleArticleTexts !== undefined ? { sampleArticleTexts: body.sampleArticleTexts } : {}),
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  const FromSourceSchema = z.object({
    source: BlogSourceSchema,
    topic: z.string().min(1),
    sampleArticleTexts: z.array(z.string()).optional(),
  });
  router.post('/from-source', async (req, res) => {
    const body = parseWith(FromSourceSchema, req.body);
    const runId = randomUUID();
    const pkg = await runBlogArticleFromSource({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      logger: deps.logger,
      source: body.source,
      topic: body.topic,
      ...(body.sampleArticleTexts !== undefined ? { sampleArticleTexts: body.sampleArticleTexts } : {}),
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  // Resolves to whichever chat session was most recently active for this platform,
  // auto-creating the first one — "New chat" (below) is the only way to explicitly
  // start a fresh thread instead of resuming this one.
  router.get('/chat', async (_req, res) => {
    const session = await getOrCreateLatestChatSession(deps.pool, 'blog');
    const messages = await listChatMessages(deps.pool, session.id);
    res.status(200).json({ sessionId: session.id, messages });
  });

  router.post('/chat/new-session', async (_req, res) => {
    const session = await createChatSession(deps.pool, 'blog');
    res.status(201).json({ sessionId: session.id, messages: [] });
  });

  const ChatSchema = z.object({
    message: z.string().min(1),
    // Optional for backward compatibility (existing tests/callers that predate
    // sessions) — falls back to the platform's latest session, same as GET /chat.
    sessionId: z.string().uuid().optional(),
    openContentId: z.string().uuid().nullable().optional(),
  });
  router.post('/chat', async (req, res) => {
    const body = parseWith(ChatSchema, req.body);
    const runId = randomUUID();
    const sessionId = body.sessionId ?? (await getOrCreateLatestChatSession(deps.pool, 'blog')).id;
    const chatResult = await handleBlogChatMessage(
      deps,
      body.message,
      { openContentId: body.openContentId ?? null, sessionId },
      runId,
    );
    res.status(200).json({ runId, ...chatResult });
  });

  // --- Blog Editorial Memory (spec 8/9/45) ---------------------------------------
  router.get('/memory', async (_req, res) => {
    const memories = await listLiveEditorialMemories(deps.pool, MEMORY_SCOPE);
    res.status(200).json({ memories });
  });

  const MemoryFeedbackSchema = z.object({
    feedback: z.string().min(1).max(2000),
    contentId: z.string().uuid().nullable().optional(),
  });
  // Explicit editorial feedback ("Quiz felt forced", "Needs more historical context")
  // → reusable patterns; unclassifiable feedback is kept in the editor's own words.
  router.post('/memory/feedback', async (req, res) => {
    const body = parseWith(MemoryFeedbackSchema, req.body);
    const runId = randomUUID();
    const outcomes = await recordEditorialFeedback({
      db: deps.pool,
      feedback: body.feedback,
      source: 'explicit_feedback',
      strength: 'explicit',
      contentId: body.contentId ?? null,
      llm: deps.llm,
      logger: deps.logger,
      runId,
      keepUnclassified: true,
    });
    res.status(201).json({ runId, memories: outcomes.map((o) => ({ ...o.memory, action: o.action })) });
  });

  const IdParamsSchema = z.object({ id: z.string().uuid() });
  router.post('/memory/:id/confirm', async (req, res) => {
    const { id } = parseWith(IdParamsSchema, req.params);
    const memory = await setEditorialMemoryStatus(deps.pool, id, 'confirm');
    res.status(200).json({ memory });
  });

  router.post('/memory/:id/reject', async (req, res) => {
    const { id } = parseWith(IdParamsSchema, req.params);
    const memory = await setEditorialMemoryStatus(deps.pool, id, 'reject');
    res.status(200).json({ memory });
  });

  // --- Blog Style Profile (spec 10/11) ---------------------------------------------
  router.get('/style/profile', async (_req, res) => {
    const samples = await listActiveStyleSamples(deps.pool);
    res.status(200).json({ profile: aggregateStyleProfile(samples), samples });
  });

  const StyleReferenceSchema = z.object({
    kind: z.enum(['own_published', 'approved_reference', 'user_supplied']),
    label: z.string().min(1).max(200),
    source: z.union([
      z.object({ kind: z.literal('url'), url: z.string().url() }),
      z.object({ kind: z.literal('text'), text: z.string().min(1).max(100_000) }),
    ]),
  });
  // Ingests an approved reference article as an abstracted style sample — the text is
  // measured and characterised, never stored.
  router.post('/style/references', async (req, res) => {
    const body = parseWith(StyleReferenceSchema, req.body);
    const runId = randomUUID();
    const sample = await ingestStyleReference({
      db: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      logger: deps.logger,
      runId,
      kind: body.kind,
      label: body.label,
      source: body.source,
    });
    res.status(201).json({ runId, sample });
  });

  router.delete('/style/samples/:id', async (req, res) => {
    const { id } = parseWith(IdParamsSchema, req.params);
    await deactivateStyleSample(deps.pool, id);
    res.status(204).end();
  });

  return router;
}
