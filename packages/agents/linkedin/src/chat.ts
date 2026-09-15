import { classifyChatIntent, loadRecentChatHistory, recordAssistantChatMessage, recordUserChatMessage } from '@bb/chat';
import { loadCurrentDna } from '@bb/content-dna';
import type { LlmClient, Logger } from '@bb/core';
import type { Pool } from '@bb/db';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { requestPublish, requestSchedule } from '@bb/workflows';
import { z } from 'zod';

import { reviseLinkedinPost } from './editPost.js';
import { runRepurpose } from './repurpose.js';
import { runSourceDiscovery } from './sourceDiscovery.js';
import { draftSingleTopicPost, proposeLinkedinAngles } from './singleTopic.js';
import { runYoutubeLink } from './youtubeLink.js';

export interface LinkedinChatDeps {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  youtubeTranscriptTool: YoutubeTranscriptTool;
  logger: Logger;
  publishConnectors: Record<string, PublishConnector>;
  scheduleConnectors: Record<string, ScheduleConnector>;
}

// The draft currently open in the dashboard's canvas, if any — chat commands like
// "rewrite this" / "schedule this" act on it. The classifier never invents a
// contentId; it only ever comes from what the UI already has open (spec 17.3:
// context isolation — the agent only sees what's needed for the requested job).
export interface LinkedinChatContext {
  openContentId?: string | null;
  sessionId: string;
}

const RepurposeSourceActionSchema = z.union([
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('text'), label: z.string().min(1), text: z.string().min(1) }),
]);

const LinkedinChatActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('source_discovery') }),
  z.object({ action: z.literal('angles'), topic: z.string().min(1) }),
  z.object({ action: z.literal('draft'), topic: z.string().min(1), angle: z.string().min(1) }),
  z.object({
    action: z.literal('repurpose'),
    source: RepurposeSourceActionSchema,
    mode: z.enum(['repurpose', 'voice_note']).default('repurpose'),
  }),
  z.object({ action: z.literal('youtube_link'), videoUrl: z.string().url() }),
  z.object({ action: z.literal('edit'), instruction: z.string().min(1) }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('schedule'), scheduledFor: z.string().datetime() }),
  z.object({ action: z.literal('unsupported'), reason: z.string() }),
]);
type LinkedinChatAction = z.infer<typeof LinkedinChatActionSchema>;

const CATALOG_DESCRIPTION = `Supported actions:
- source_discovery {}: find topics from the creator's trusted LinkedIn sources and draft posts on them. Use for requests like "find me topics from my trusted creators".
- angles { topic }: propose 2-3 angles for a topic the user names, without drafting yet.
- draft { topic, angle }: draft a full post for an already-chosen topic + angle (use after angles have been discussed, or if the user gives both directly).
- repurpose { source: { kind: 'url', url } | { kind: 'text', label, text }, mode: 'repurpose' | 'voice_note' }: turn an article/PDF/transcript/voice-note text into post drafts.
- youtube_link { videoUrl }: turn a YouTube video into post drafts.
- edit { instruction }: revise the draft that is CURRENTLY OPEN in the dashboard per a natural-language instruction (e.g. "make this less aggressive"). There is no separate "which draft" parameter — it always means the open one.
- publish {}: publish the currently open draft (only works if it has already been approved).
- schedule { scheduledFor }: schedule the currently open draft for an ISO 8601 datetime (only works if it has already been approved).`;

export interface LinkedinChatResult {
  reply: string;
  action: string;
  result: unknown;
}

function needsOpenDraft(context: LinkedinChatContext): string {
  if (!context.openContentId) {
    throw new NoOpenDraftError();
  }
  return context.openContentId;
}

export class NoOpenDraftError extends Error {
  constructor() {
    super('No draft is currently open — open a draft first, or ask me to create one.');
    this.name = 'NoOpenDraftError';
  }
}

async function dispatch(
  deps: LinkedinChatDeps,
  action: LinkedinChatAction,
  context: LinkedinChatContext,
  runId: string,
): Promise<{ reply: string; result: unknown }> {
  switch (action.action) {
    case 'source_discovery': {
      const packages = await runSourceDiscovery({ ...deps, runId });
      const topics = packages.map((pkg) => pkg.topic).join('; ');
      return { reply: `Found ${packages.length} draft(s) from your trusted sources: ${topics}.`, result: packages };
    }
    case 'angles': {
      const dna = await loadCurrentDna(deps.pool);
      const angles = await proposeLinkedinAngles(action.topic, dna, deps.llm, runId);
      const list = angles.map((a, i) => `${i + 1}. ${a.angle}`).join('\n');
      return { reply: `Here are some angles for "${action.topic}":\n${list}`, result: angles };
    }
    case 'draft': {
      const pkg = await draftSingleTopicPost({ pool: deps.pool, llm: deps.llm, topic: action.topic, angle: action.angle, runId });
      return {
        reply: `Drafted a LinkedIn post about "${action.topic}" (angle: "${action.angle}"). It's now in review.`,
        result: pkg,
      };
    }
    case 'repurpose': {
      const packages = await runRepurpose({
        pool: deps.pool,
        llm: deps.llm,
        fetchTool: deps.fetchTool,
        source: action.source,
        mode: action.mode,
        logger: deps.logger,
        runId,
      });
      return { reply: `Turned that source into ${packages.length} draft(s). They're now in review.`, result: packages };
    }
    case 'youtube_link': {
      const packages = await runYoutubeLink({
        pool: deps.pool,
        llm: deps.llm,
        fetchTool: deps.fetchTool,
        youtubeTranscriptTool: deps.youtubeTranscriptTool,
        videoUrl: action.videoUrl,
        logger: deps.logger,
        runId,
      });
      return { reply: `Turned that video into ${packages.length} draft(s). They're now in review.`, result: packages };
    }
    case 'edit': {
      const contentId = needsOpenDraft(context);
      const { package: pkg, learningEvent } = await reviseLinkedinPost({
        pool: deps.pool,
        llm: deps.llm,
        contentId,
        instruction: action.instruction,
        runId,
      });
      const learningNote = learningEvent ? ' I also noticed a possible voice preference — check the DNA panel to confirm it.' : '';
      return { reply: `Updated the draft.${learningNote}`, result: { package: pkg, learningEvent } };
    }
    case 'publish': {
      const contentId = needsOpenDraft(context);
      const { item, event } = await requestPublish(deps.pool, contentId, deps.publishConnectors);
      const reply =
        event.result === 'success'
          ? `Published. ${event.platformUrl ?? ''}`.trim()
          : `Publish failed: ${event.error ?? 'unknown error'}`;
      return { reply, result: { item, event } };
    }
    case 'schedule': {
      const contentId = needsOpenDraft(context);
      const { item, event } = await requestSchedule(
        deps.pool,
        contentId,
        new Date(action.scheduledFor),
        deps.scheduleConnectors,
      );
      const reply =
        event.result === 'success'
          ? `Scheduled for ${action.scheduledFor}.`
          : `Scheduling failed: ${event.error ?? 'unknown error'}`;
      return { reply, result: { item, event } };
    }
    case 'unsupported':
      return { reply: `I can't do that yet: ${action.reason}`, result: null };
  }
}

export async function handleLinkedinChatMessage(
  deps: LinkedinChatDeps,
  message: string,
  context: LinkedinChatContext,
  runId: string,
): Promise<LinkedinChatResult> {
  const recentHistory = await loadRecentChatHistory(deps.pool, context.sessionId);
  await recordUserChatMessage(deps.pool, context.sessionId, 'linkedin', message);

  const classified = await classifyChatIntent({
    llm: deps.llm,
    platform: 'linkedin',
    catalogDescription: CATALOG_DESCRIPTION,
    actionsSchema: LinkedinChatActionSchema,
    message,
    recentHistory,
    runId,
  });

  let reply: string;
  let result: unknown;
  try {
    ({ reply, result } = await dispatch(deps, classified, context, runId));
  } catch (error) {
    if (error instanceof NoOpenDraftError) {
      reply = error.message;
      result = null;
    } else {
      throw error;
    }
  }

  const { action: actionName, ...params } = classified;
  await recordAssistantChatMessage(deps.pool, context.sessionId, 'linkedin', reply, { name: actionName, params });

  return { reply, action: actionName, result };
}
