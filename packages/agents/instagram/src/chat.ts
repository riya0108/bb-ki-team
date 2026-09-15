import { classifyChatIntent, loadRecentChatHistory, recordAssistantChatMessage, recordUserChatMessage } from '@bb/chat';
import type { LlmClient } from '@bb/core';
import type { Pool } from '@bb/db';
import { InstagramFormatSchema } from '@bb/shared-types';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { requestPublish, requestSchedule } from '@bb/workflows';
import { z } from 'zod';

import { runInstagramHead } from './headAgent.js';

export interface InstagramChatDeps {
  pool: Pool;
  llm: LlmClient;
  publishConnectors: Record<string, PublishConnector>;
  scheduleConnectors: Record<string, ScheduleConnector>;
}

export interface InstagramChatContext {
  openContentId?: string | null;
  sessionId: string;
}

const InstagramChatActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('draft'),
    topic: z.string().min(1),
    angle: z.string().min(1),
    // Spec 7.1: the user may explicitly name the format, otherwise the head agent
    // routes it itself — omit rather than guess if the message doesn't name one.
    format: InstagramFormatSchema.optional(),
  }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('schedule'), scheduledFor: z.string().datetime() }),
  z.object({ action: z.literal('unsupported'), reason: z.string() }),
]);
type InstagramChatAction = z.infer<typeof InstagramChatActionSchema>;

const CATALOG_DESCRIPTION = `Supported actions:
- draft { topic, angle, format?: 'post' | 'carousel' | 'reel' }: draft an Instagram post, carousel, or Reel for an already-chosen topic + angle. Only set format if the user explicitly names one (e.g. "make this a carousel") — otherwise omit it and the system will route it itself.
- publish {}: publish the currently open draft (only works if it has already been approved).
- schedule { scheduledFor }: schedule the currently open draft for an ISO 8601 datetime (only works if it has already been approved).
There is no support yet for turning an existing draft into a different format (e.g. "turn this carousel into a Reel") or for natural-language edit instructions on an existing draft — treat those as unsupported.`;

export interface InstagramChatResult {
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

function needsOpenDraft(context: InstagramChatContext): string {
  if (!context.openContentId) throw new NoOpenDraftError();
  return context.openContentId;
}

async function dispatch(
  deps: InstagramChatDeps,
  action: InstagramChatAction,
  context: InstagramChatContext,
  runId: string,
): Promise<{ reply: string; result: unknown }> {
  switch (action.action) {
    case 'draft': {
      const pkg = await runInstagramHead({
        pool: deps.pool,
        llm: deps.llm,
        topic: action.topic,
        angle: action.angle,
        ...(action.format !== undefined ? { format: action.format } : {}),
        runId,
      });
      return {
        reply: `Drafted an Instagram ${pkg.format} about "${action.topic}". It's now in review.`,
        result: pkg,
      };
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

export async function handleInstagramChatMessage(
  deps: InstagramChatDeps,
  message: string,
  context: InstagramChatContext,
  runId: string,
): Promise<InstagramChatResult> {
  const recentHistory = await loadRecentChatHistory(deps.pool, context.sessionId);
  await recordUserChatMessage(deps.pool, context.sessionId, 'instagram', message);

  const classified = await classifyChatIntent({
    llm: deps.llm,
    platform: 'instagram',
    catalogDescription: CATALOG_DESCRIPTION,
    actionsSchema: InstagramChatActionSchema,
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
  await recordAssistantChatMessage(deps.pool, context.sessionId, 'instagram', reply, { name: actionName, params });

  return { reply, action: actionName, result };
}
