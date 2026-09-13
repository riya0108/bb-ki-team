import { randomUUID } from 'node:crypto';

import {
  answerPostcastInterviewTurn,
  draftPostcastIdea,
  draftSingleTopicPost,
  generatePostcastPostIdeas,
  proposeLinkedinAngles,
  reviseLinkedinPost,
  runRepurpose,
  runSourceDiscovery,
  runYoutubeLink,
  startPostcastInterview,
} from '@bb/agent-linkedin';
import { loadCurrentDna } from '@bb/content-dna';
import { Router } from 'express';
import { z } from 'zod';

import type { AppDeps } from '../deps.js';
import { parseWith } from '../validation.js';

const RepurposeSourceSchema = z.union([
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('text'), label: z.string().min(1), text: z.string().min(1) }),
]);

export function createLinkedinRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/source-discovery', async (_req, res) => {
    const runId = randomUUID();
    const packages = await runSourceDiscovery({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      logger: deps.logger,
      runId,
    });
    res.status(201).json({ runId, packages });
  });

  const SingleTopicAnglesSchema = z.object({ topic: z.string().min(1) });
  router.post('/single-topic/angles', async (req, res) => {
    const { topic } = parseWith(SingleTopicAnglesSchema, req.body);
    const runId = randomUUID();
    const dna = await loadCurrentDna(deps.pool);
    const angles = await proposeLinkedinAngles(topic, dna, deps.llm, runId);
    res.status(200).json({ runId, angles });
  });

  const SingleTopicDraftSchema = z.object({ topic: z.string().min(1), angle: z.string().min(1) });
  router.post('/single-topic/draft', async (req, res) => {
    const { topic, angle } = parseWith(SingleTopicDraftSchema, req.body);
    const runId = randomUUID();
    const pkg = await draftSingleTopicPost({ pool: deps.pool, llm: deps.llm, topic, angle, runId });
    res.status(201).json({ runId, package: pkg });
  });

  const PostcastStartSchema = z.object({ topic: z.string().min(1).nullable().default(null) });
  router.post('/postcast/start', async (req, res) => {
    const { topic } = parseWith(PostcastStartSchema, req.body);
    const runId = randomUUID();
    const session = await startPostcastInterview({ pool: deps.pool, llm: deps.llm, topic, runId });
    res.status(201).json({ runId, session });
  });

  const PostcastAnswerSchema = z.object({ answer: z.string().min(1) });
  router.post('/postcast/:sessionId/answer', async (req, res) => {
    const { answer } = parseWith(PostcastAnswerSchema, req.body);
    const runId = randomUUID();
    const session = await answerPostcastInterviewTurn({
      pool: deps.pool,
      llm: deps.llm,
      sessionId: req.params.sessionId ?? '',
      answer,
      runId,
    });
    res.status(200).json({ runId, session });
  });

  router.post('/postcast/:sessionId/ideas', async (req, res) => {
    const runId = randomUUID();
    const ideas = await generatePostcastPostIdeas({
      pool: deps.pool,
      llm: deps.llm,
      sessionId: req.params.sessionId ?? '',
      runId,
    });
    res.status(200).json({ runId, ideas });
  });

  const PostcastDraftSchema = z.object({
    topic: z.string().min(1),
    angle: z.string().min(1),
    coreClaim: z.string().nullable().optional(),
  });
  router.post('/postcast/:sessionId/draft', async (req, res) => {
    const body = parseWith(PostcastDraftSchema, req.body);
    const runId = randomUUID();
    const pkg = await draftPostcastIdea({
      pool: deps.pool,
      llm: deps.llm,
      sessionId: req.params.sessionId ?? '',
      topic: body.topic,
      angle: body.angle,
      coreClaim: body.coreClaim ?? null,
      runId,
    });
    res.status(201).json({ runId, package: pkg });
  });

  const RepurposeSchema = z.object({
    source: RepurposeSourceSchema,
    mode: z.enum(['repurpose', 'voice_note']).default('repurpose'),
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
      mode: body.mode,
      logger: deps.logger,
      runId,
      ...(body.postCount !== undefined ? { postCount: body.postCount } : {}),
    });
    res.status(201).json({ runId, packages });
  });

  const YoutubeLinkSchema = z.object({
    videoUrl: z.string().url(),
    postCount: z.number().int().min(1).max(3).optional(),
  });
  router.post('/youtube-link', async (req, res) => {
    const body = parseWith(YoutubeLinkSchema, req.body);
    const runId = randomUUID();
    const packages = await runYoutubeLink({
      pool: deps.pool,
      llm: deps.llm,
      fetchTool: deps.fetchTool,
      youtubeTranscriptTool: deps.youtubeTranscriptTool,
      videoUrl: body.videoUrl,
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
    const { package: pkg, learningEvent } = await reviseLinkedinPost({
      pool: deps.pool,
      llm: deps.llm,
      contentId: body.contentId,
      instruction: body.instruction,
      runId,
    });
    res.status(200).json({ runId, package: pkg, learningEvent });
  });

  return router;
}
