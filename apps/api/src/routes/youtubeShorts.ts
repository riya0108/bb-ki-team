import { randomUUID } from 'node:crypto';

import { handleYoutubeShortsChatMessage, runYoutubeShort, runYoutubeShortFromSource } from '@bb/agent-youtube-shorts';
import { listChatMessages } from '@bb/db';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

const ShortsSourceSchema = z.union([
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('text'), label: z.string().min(1), text: z.string().min(1) }),
  z.object({ kind: z.literal('youtube'), videoUrl: z.string().url() }),
]);

export function createYoutubeShortsRouter(deps: AppDeps): Router {
  const router = Router();

  const DraftSchema = z.object({
    topic: z.string().min(1),
    angle: z.string().min(1),
    coreClaim: z.string().nullable().optional(),
    sourceReferences: z.array(z.string()).optional(),
    sourceTexts: z.array(z.string()).optional(),
  });
  router.post('/draft', async (req, res) => {
    const body = parseWith(DraftSchema, req.body);
    const runId = randomUUID();
    const pkg = await runYoutubeShort({
      pool: deps.pool,
      llm: deps.llm,
      topic: body.topic,
      angle: body.angle,
      coreClaim: body.coreClaim ?? null,
      ...(body.sourceReferences !== undefined ? { sourceReferences: body.sourceReferences } : {}),
      ...(body.sourceTexts !== undefined ? { sourceTexts: body.sourceTexts } : {}),
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  const FromSourceSchema = z.object({ source: ShortsSourceSchema });
  router.post('/from-source', async (req, res) => {
    const body = parseWith(FromSourceSchema, req.body);
    const runId = randomUUID();
    const pkg = await runYoutubeShortFromSource({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      youtubeTranscriptTool: deps.youtubeTranscriptTool,
      source: body.source,
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  router.get('/chat', async (_req, res) => {
    const messages = await listChatMessages(deps.pool, 'youtube-shorts');
    res.status(200).json({ messages });
  });

  const ChatSchema = z.object({ message: z.string().min(1), openContentId: z.string().uuid().nullable().optional() });
  router.post('/chat', async (req, res) => {
    const body = parseWith(ChatSchema, req.body);
    const runId = randomUUID();
    const chatResult = await handleYoutubeShortsChatMessage(
      deps,
      body.message,
      { openContentId: body.openContentId ?? null },
      runId,
    );
    res.status(200).json({ runId, ...chatResult });
  });

  return router;
}
