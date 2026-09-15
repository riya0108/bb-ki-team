import { classifyChatIntent, loadRecentChatHistory, recordAssistantChatMessage, recordUserChatMessage } from '@bb/chat';
import { loadCurrentDna } from '@bb/content-dna';
import type { LlmClient, Logger } from '@bb/core';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { requestPublish, requestSchedule } from '@bb/workflows';
import { z } from 'zod';

import { reviseXPost } from './editPost.js';
import { runQuote } from './quote.js';
import { runRepurpose } from './repurpose.js';
import { runSourceDiscovery } from './sourceDiscovery.js';
import { draftXTopicPost, proposeXAngles } from './topicMode.js';

export interface XChatDeps {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  logger: Logger;
  publishConnectors: Record<string, PublishConnector>;
  scheduleConnectors: Record<string, ScheduleConnector>;
}

export interface XChatContext {
  openContentId?: string | null;
  sessionId: string;
}

const SourceActionSchema = z.union([
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('text'), label: z.string().min(1), text: z.string().min(1) }),
]);

const XChatActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('source_discovery') }),
  z.object({ action: z.literal('angles'), topic: z.string().min(1) }),
  z.object({ action: z.literal('draft'), topic: z.string().min(1), angle: z.string().min(1) }),
  z.object({ action: z.literal('thread_draft'), topic: z.string().min(1), angle: z.string().min(1) }),
  z.object({ action: z.literal('quote'), source: SourceActionSchema, commentaryAngle: z.string().min(1) }),
  z.object({ action: z.literal('repurpose'), source: SourceActionSchema }),
  z.object({ action: z.literal('edit'), instruction: z.string().min(1) }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('schedule'), scheduledFor: z.string().datetime() }),
  z.object({ action: z.literal('unsupported'), reason: z.string() }),
]);
type XChatAction = z.infer<typeof XChatActionSchema>;

const CATALOG_DESCRIPTION = `Supported actions:
- source_discovery {}: find topics from the creator's trusted X sources and draft posts on them.
- angles { topic }: propose angles for a topic, without drafting yet.
- draft { topic, angle }: draft a single X post for an already-chosen topic + angle.
- thread_draft { topic, angle }: draft an X thread for an already-chosen topic + angle. Use when the user explicitly asks for a thread.
- quote { source: { kind: 'url', url } | { kind: 'text', label, text }, commentaryAngle }: draft a quote-post reacting to a source with the creator's own point of view.
- repurpose { source: { kind: 'url', url } | { kind: 'text', label, text } }: turn an article/text into post drafts.
- edit { instruction }: revise the draft that is CURRENTLY OPEN in the dashboard per a natural-language instruction. There is no separate "which draft" parameter — it always means the open one.
- publish {}: publish the currently open draft (only works if it has already been approved).
- schedule { scheduledFor }: schedule the currently open draft for an ISO 8601 datetime (only works if it has already been approved).`;

export interface XChatResult {
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

function needsOpenDraft(context: XChatContext): string {
  if (!context.openContentId) throw new NoOpenDraftError();
  return context.openContentId;
}

async function dispatch(
  deps: XChatDeps,
  action: XChatAction,
  context: XChatContext,
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
      const angles = await proposeXAngles(action.topic, dna, deps.llm, runId);
      const list = angles.map((a, i) => `${i + 1}. ${a.angle}`).join('\n');
      return { reply: `Here are some angles for "${action.topic}":\n${list}`, result: angles };
    }
    case 'draft': {
      const pkg = await draftXTopicPost({ pool: deps.pool, llm: deps.llm, topic: action.topic, angle: action.angle, mode: 'single_topic', runId });
      return { reply: `Drafted an X post about "${action.topic}". It's now in review.`, result: pkg };
    }
    case 'thread_draft': {
      const pkg = await draftXTopicPost({ pool: deps.pool, llm: deps.llm, topic: action.topic, angle: action.angle, mode: 'thread', runId });
      return { reply: `Drafted an X thread about "${action.topic}". It's now in review.`, result: pkg };
    }
    case 'quote': {
      const pkg = await runQuote({
        pool: deps.pool,
        llm: deps.llm,
        fetchTool: deps.fetchTool,
        source: action.source,
        commentaryAngle: action.commentaryAngle,
        runId,
      });
      return { reply: `Drafted a quote post. It's now in review.`, result: pkg };
    }
    case 'repurpose': {
      const packages = await runRepurpose({
        pool: deps.pool,
        llm: deps.llm,
        fetchTool: deps.fetchTool,
        source: action.source,
        logger: deps.logger,
        runId,
      });
      return { reply: `Turned that source into ${packages.length} draft(s). They're now in review.`, result: packages };
    }
    case 'edit': {
      const contentId = needsOpenDraft(context);
      const { package: pkg, learningEvent } = await reviseXPost({
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

export async function handleXChatMessage(
  deps: XChatDeps,
  message: string,
  context: XChatContext,
  runId: string,
): Promise<XChatResult> {
  const recentHistory = await loadRecentChatHistory(deps.pool, context.sessionId);
  await recordUserChatMessage(deps.pool, context.sessionId, 'x', message);

  const classified = await classifyChatIntent({
    llm: deps.llm,
    platform: 'x',
    catalogDescription: CATALOG_DESCRIPTION,
    actionsSchema: XChatActionSchema,
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
  await recordAssistantChatMessage(deps.pool, context.sessionId, 'x', reply, { name: actionName, params });

  return { reply, action: actionName, result };
}
