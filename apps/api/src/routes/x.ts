import { randomUUID } from 'node:crypto';

import {
  draftXTopicPost,
  handleXChatMessage,
  proposeXAngles,
  reviseXPost,
  runQuote,
  runRepurpose,
  runSourceDiscovery,
} from '@bb/agent-x';
import { loadCurrentDna } from '@bb/content-dna';
import { createChatSession, getOrCreateLatestChatSession, listChatMessages } from '@bb/db';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

const RepurposeSourceSchema = z.union([
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('text'), label: z.string().min(1), text: z.string().min(1) }),
]);

export function createXRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/source-discovery', async (req, res) => {
    const TopicCountSchema = z.object({ topicCount: z.number().int().min(1).max(3).optional() });
    const body = parseWith(TopicCountSchema, req.body);
    const runId = randomUUID();
    const packages = await runSourceDiscovery({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      logger: deps.logger,
      runId,
      ...(body.topicCount !== undefined ? { topicCount: body.topicCount } : {}),
    });
    res.status(201).json({ runId, packages });
  });

  const AnglesSchema = z.object({ topic: z.string().min(1) });
  router.post('/angles', async (req, res) => {
    const { topic } = parseWith(AnglesSchema, req.body);
    const runId = randomUUID();
    const dna = await loadCurrentDna(deps.pool);
    const angles = await proposeXAngles(topic, dna, deps.llm, runId);
    res.status(200).json({ runId, angles });
  });

  // angle is optional: without one, the editorial pipeline researches the story and
  // selects the strongest verified angle itself.
  const TopicDraftSchema = z.object({ topic: z.string().min(1), angle: z.string().min(1).nullable().default(null) });
  router.post('/single-post/draft', async (req, res) => {
    const { topic, angle } = parseWith(TopicDraftSchema, req.body);
    const runId = randomUUID();
    const pkg = await draftXTopicPost({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      logger: deps.logger,
      topic,
      angle,
      mode: 'single_topic',
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  router.post('/thread/draft', async (req, res) => {
    const { topic, angle } = parseWith(TopicDraftSchema, req.body);
    const runId = randomUUID();
    const pkg = await draftXTopicPost({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      logger: deps.logger,
      topic,
      angle,
      mode: 'thread',
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  const QuoteSchema = z.object({ source: RepurposeSourceSchema, commentaryAngle: z.string().min(1) });
  router.post('/quote', async (req, res) => {
    const body = parseWith(QuoteSchema, req.body);
    const runId = randomUUID();
    const pkg = await runQuote({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      source: body.source,
      commentaryAngle: body.commentaryAngle,
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  const RepurposeSchema = z.object({
    source: RepurposeSourceSchema,
    postCount: z.number().int().min(1).max(3).optional(),
  });
  router.post('/repurpose', async (req, res) => {
    const body = parseWith(RepurposeSchema, req.body);
    const runId = randomUUID();
    const packages = await runRepurpose({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      source: body.source,
      logger: deps.logger,
      runId,
      ...(body.postCount !== undefined ? { postCount: body.postCount } : {}),
    });
    res.status(201).json({ runId, packages });
  });

  const EditSchema = z.object({ contentId: z.string().uuid(), instruction: z.string().min(1) });
  router.post('/edit', async (req, res) => {
    const body = parseWith(EditSchema, req.body);
    const runId = randomUUID();
    const { package: pkg, learningEvent } = await reviseXPost({
      pool: deps.pool,
      llm: deps.llm,
      contentId: body.contentId,
      instruction: body.instruction,
      runId,
    });
    res.status(200).json({ runId, package: pkg, learningEvent });
  });

  router.get('/chat', async (_req, res) => {
    const session = await getOrCreateLatestChatSession(deps.pool, 'x');
    const messages = await listChatMessages(deps.pool, session.id);
    res.status(200).json({ sessionId: session.id, messages });
  });

  router.post('/chat/new-session', async (_req, res) => {
    const session = await createChatSession(deps.pool, 'x');
    res.status(201).json({ sessionId: session.id, messages: [] });
  });

  const ChatSchema = z.object({
    message: z.string().min(1),
    sessionId: z.string().uuid().optional(),
    openContentId: z.string().uuid().nullable().optional(),
  });
  router.post('/chat', async (req, res) => {
    const body = parseWith(ChatSchema, req.body);
    const runId = randomUUID();
    const sessionId = body.sessionId ?? (await getOrCreateLatestChatSession(deps.pool, 'x')).id;
    const chatResult = await handleXChatMessage(
      deps,
      body.message,
      { openContentId: body.openContentId ?? null, sessionId },
      runId,
    );
    res.status(200).json({ runId, ...chatResult });
  });

  return router;
}
