import { classifyChatIntent, loadRecentChatHistory, recordAssistantChatMessage, recordUserChatMessage } from '@bb/chat';
import type { LlmClient, Logger } from '@bb/core';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';
import { ContentItemNotFoundError, getContentItem, requestPublish, requestSchedule } from '@bb/workflows';
import { z } from 'zod';

import { reviseBlogArticle } from './editArticle.js';
import { runBlogArticle } from './headAgent.js';
import { runBlogArticleFromSource } from './repurpose.js';

export interface BlogChatDeps {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  logger: Logger;
  publishConnectors: Record<string, PublishConnector>;
  scheduleConnectors: Record<string, ScheduleConnector>;
}

export interface BlogChatContext {
  openContentId?: string | null;
  sessionId: string;
}

const SourceActionSchema = z.union([
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('text'), label: z.string().min(1), text: z.string().min(1) }),
]);

const BlogChatActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('draft'), topic: z.string().min(1), articleType: z.string().min(1).default('New article') }),
  z.object({ action: z.literal('from_source'), source: SourceActionSchema, topic: z.string().min(1) }),
  z.object({ action: z.literal('show_html') }),
  z.object({ action: z.literal('edit'), instruction: z.string().min(1) }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('schedule'), scheduledFor: z.string().datetime() }),
  z.object({ action: z.literal('unsupported'), reason: z.string() }),
]);
type BlogChatAction = z.infer<typeof BlogChatActionSchema>;

const CATALOG_DESCRIPTION = `Supported actions:
- draft { topic, articleType }: write a new Bull or Bear blog article on a topic. articleType is a framing label (e.g. "Explainer", "How-to guide", "Comparison/review") — default to "New article" if the user doesn't specify one.
- from_source { source: { kind: 'url', url } | { kind: 'text', label, text }, topic }: write a source-led article from an article/PDF/transcript.
- show_html {}: show the generated HTML file for the draft that is CURRENTLY OPEN in the dashboard.
- edit { instruction }: revise the draft that is CURRENTLY OPEN in the dashboard per a natural-language instruction — any text, section, tone, length, or formatting/component change (e.g. "shorten the second section", "add a pull quote after the intro", "make the title punchier"). There is no separate "which draft" parameter — it always means the open one. Never tell the user to edit the HTML themselves; this action does it.
- publish {}: publish the currently open draft (only works if it has already been approved).
- schedule { scheduledFor }: schedule the currently open draft for an ISO 8601 datetime (only works if it has already been approved).`;

export interface BlogChatResult {
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

function needsOpenDraft(context: BlogChatContext): string {
  if (!context.openContentId) throw new NoOpenDraftError();
  return context.openContentId;
}

async function dispatch(
  deps: BlogChatDeps,
  action: BlogChatAction,
  context: BlogChatContext,
  runId: string,
  message: string,
): Promise<{ reply: string; result: unknown }> {
  switch (action.action) {
    case 'draft': {
      const pkg = await runBlogArticle({
        pool: deps.pool,
        llm: deps.llm,
        fetchTool: deps.fetchTool,
        logger: deps.logger,
        topic: action.topic,
        articleType: action.articleType,
        userMessage: message,
        runId,
      });
      return { reply: `Wrote a blog article: "${pkg.title}". It's now in review.`, result: pkg };
    }
    case 'from_source': {
      const pkg = await runBlogArticleFromSource({
        pool: deps.pool,
        llm: deps.llm,
        fetchTool: deps.fetchTool,
        logger: deps.logger,
        source: action.source,
        topic: action.topic,
        userMessage: message,
        runId,
      });
      return { reply: `Wrote a source-led blog article: "${pkg.title}". It's now in review.`, result: pkg };
    }
    case 'show_html': {
      const contentId = needsOpenDraft(context);
      const item = await getContentItem(deps.pool, contentId);
      if (!item) throw new ContentItemNotFoundError(contentId);
      // The Blog agent stores the rendered HTML as the item's currentText (spec 12:
      // "the HTML file" IS the article's canonical text for this platform), not inside
      // `package` — packaging.ts's buildBlogPackage reads it the same way.
      if (!item.currentText) return { reply: "This draft doesn't have a generated HTML file yet.", result: null };
      return { reply: 'Here is the HTML file for the open draft.', result: { htmlFile: item.currentText } };
    }
    case 'edit': {
      const contentId = needsOpenDraft(context);
      const { package: pkg, learningEvent } = await reviseBlogArticle({
        pool: deps.pool,
        llm: deps.llm,
        contentId,
        instruction: action.instruction,
        runId,
        logger: deps.logger,
      });
      const learningNote = learningEvent ? ' I also noticed a possible voice preference — check the DNA panel to confirm it.' : '';
      return { reply: `Updated the article.${learningNote}`, result: { package: pkg, learningEvent } };
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

export async function handleBlogChatMessage(
  deps: BlogChatDeps,
  message: string,
  context: BlogChatContext,
  runId: string,
): Promise<BlogChatResult> {
  const recentHistory = await loadRecentChatHistory(deps.pool, context.sessionId);
  await recordUserChatMessage(deps.pool, context.sessionId, 'blog', message);

  const classified = await classifyChatIntent({
    llm: deps.llm,
    platform: 'blog',
    catalogDescription: CATALOG_DESCRIPTION,
    actionsSchema: BlogChatActionSchema,
    message,
    recentHistory,
    runId,
  });

  let reply: string;
  let result: unknown;
  try {
    ({ reply, result } = await dispatch(deps, classified, context, runId, message));
  } catch (error) {
    if (error instanceof NoOpenDraftError) {
      reply = error.message;
      result = null;
    } else {
      throw error;
    }
  }

  const { action: actionName, ...params } = classified;
  await recordAssistantChatMessage(deps.pool, context.sessionId, 'blog', reply, { name: actionName, params });

  return { reply, action: actionName, result };
}
