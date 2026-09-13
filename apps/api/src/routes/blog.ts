import { randomUUID } from 'node:crypto';

import { handleBlogChatMessage, runBlogArticle, runBlogArticleFromSource } from '@bb/agent-blog';
import { listChatMessages } from '@bb/db';
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
      source: body.source,
      topic: body.topic,
      ...(body.sampleArticleTexts !== undefined ? { sampleArticleTexts: body.sampleArticleTexts } : {}),
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  router.get('/chat', async (_req, res) => {
    const messages = await listChatMessages(deps.pool, 'blog');
    res.status(200).json({ messages });
  });

  const ChatSchema = z.object({ message: z.string().min(1), openContentId: z.string().uuid().nullable().optional() });
  router.post('/chat', async (req, res) => {
    const body = parseWith(ChatSchema, req.body);
    const runId = randomUUID();
    const chatResult = await handleBlogChatMessage(deps, body.message, { openContentId: body.openContentId ?? null }, runId);
    res.status(200).json({ runId, ...chatResult });
  });

  return router;
}
