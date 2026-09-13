import { classifyChatIntent, loadRecentChatHistory, recordAssistantChatMessage, recordUserChatMessage } from '@bb/chat';
import type { LlmClient } from '@bb/core';
import type { Pool } from '@bb/db';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { requestPublish, requestSchedule } from '@bb/workflows';
import { z } from 'zod';

import { runYoutubeShort } from './headAgent.js';
import { runYoutubeShortFromSource } from './repurpose.js';

export interface YoutubeShortsChatDeps {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  youtubeTranscriptTool: YoutubeTranscriptTool;
  publishConnectors: Record<string, PublishConnector>;
  scheduleConnectors: Record<string, ScheduleConnector>;
}

export interface YoutubeShortsChatContext {
  openContentId?: string | null;
}

const SourceActionSchema = z.union([
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('text'), label: z.string().min(1), text: z.string().min(1) }),
  z.object({ kind: z.literal('youtube'), videoUrl: z.string().url() }),
]);

const YoutubeShortsChatActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('draft'), topic: z.string().min(1), angle: z.string().min(1) }),
  z.object({ action: z.literal('from_source'), source: SourceActionSchema }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('schedule'), scheduledFor: z.string().datetime() }),
  z.object({ action: z.literal('unsupported'), reason: z.string() }),
]);
type YoutubeShortsChatAction = z.infer<typeof YoutubeShortsChatActionSchema>;

const CATALOG_DESCRIPTION = `Supported actions:
- draft { topic, angle }: draft a YouTube Short script for an already-chosen topic + angle.
- from_source { source: { kind: 'url', url } | { kind: 'text', label, text } | { kind: 'youtube', videoUrl } }: turn an article, transcript, or YouTube video into one Short script.
- publish {}: publish the currently open draft (only works if it has already been approved).
- schedule { scheduledFor }: schedule the currently open draft for an ISO 8601 datetime (only works if it has already been approved).
There is no support yet for natural-language edit instructions on an existing draft — treat those as unsupported.`;

export interface YoutubeShortsChatResult {
  reply: string;
  action: string;
  result: unknown;
}

export class NoOpenDraftError extends Error {
  constructor() {
    super('No draft is currently open — open a draft first, or ask me to create one.');
    this.name = 'NoOpenDraftError';
  }
}

function needsOpenDraft(context: YoutubeShortsChatContext): string {
  if (!context.openContentId) throw new NoOpenDraftError();
  return context.openContentId;
}

async function dispatch(
  deps: YoutubeShortsChatDeps,
  action: YoutubeShortsChatAction,
  context: YoutubeShortsChatContext,
  runId: string,
): Promise<{ reply: string; result: unknown }> {
  switch (action.action) {
    case 'draft': {
      const pkg = await runYoutubeShort({ pool: deps.pool, llm: deps.llm, topic: action.topic, angle: action.angle, runId });
      return { reply: `Drafted a YouTube Short about "${action.topic}". It's now in review.`, result: pkg };
    }
    case 'from_source': {
      const pkg = await runYoutubeShortFromSource({
        pool: deps.pool,
        llm: deps.llm,
        fetchTool: deps.fetchTool,
        youtubeTranscriptTool: deps.youtubeTranscriptTool,
        source: action.source,
        runId,
      });
      return { reply: `Turned that source into a YouTube Short script. It's now in review.`, result: pkg };
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

export async function handleYoutubeShortsChatMessage(
  deps: YoutubeShortsChatDeps,
  message: string,
  context: YoutubeShortsChatContext,
  runId: string,
): Promise<YoutubeShortsChatResult> {
  const recentHistory = await loadRecentChatHistory(deps.pool, 'youtube-shorts');
  await recordUserChatMessage(deps.pool, 'youtube-shorts', message);

  const classified = await classifyChatIntent({
    llm: deps.llm,
    platform: 'youtube-shorts',
    catalogDescription: CATALOG_DESCRIPTION,
    actionsSchema: YoutubeShortsChatActionSchema,
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
  await recordAssistantChatMessage(deps.pool, 'youtube-shorts', reply, { name: actionName, params });

  return { reply, action: actionName, result };
}
