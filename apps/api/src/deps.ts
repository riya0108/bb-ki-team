import type { EmailConfig, Env, LlmClient, Logger } from '@bb/core';
import { createFallbackLlmClient, createLogger, loadEnv } from '@bb/core';
import type { Pool } from '@bb/db';
import { createPool } from '@bb/db';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import {
  createBlogGitPublishConnector,
  createBlogGitScheduleConnector,
  createBufferPublishConnector,
  createLinkedinMcpClient,
  createXScheduleConnector,
  createYoutubeTranscriptMcpClient,
} from '@bb/mcp-client';
import type { PublishConnector, ScheduleConnector } from '@bb/workflows';

// Single composition root: everything a route handler needs, built once at process
// startup (or once per test) rather than each module reaching for ambient globals —
// keeps every route testable in isolation with fake deps (CLAUDE.md).
export interface AppDeps {
  env: Env;
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  youtubeTranscriptTool: YoutubeTranscriptTool;
  logger: Logger;
  // Keyed by platform. A platform with no entry here means every publish/schedule
  // request for it honestly fails and is logged rather than pretending to succeed
  // (CLAUDE.md: never fabricate success; spec 15.4).
  //
  // X's own direct API (packages/mcp-client's createXPublishConnector, still present
  // but unregistered below) was tried live and X rejected it with 402
  // "credits-depleted" — POST /2/tweets draws from this account's paid credit
  // balance, which is $0 on purpose (no card on file). The real X publish/schedule
  // path is instead Buffer (createBufferPublishConnector): it posts to the connected
  // X account on this account's behalf without touching X's paid API. X's
  // ScheduleConnector does no external call itself — it just lets requestSchedule
  // record the target time; apps/worker's own poll loop later calls this same
  // publish connector once that time arrives (see apps/worker/src/deps.ts).
  publishConnectors: Record<string, PublishConnector>;
  scheduleConnectors: Record<string, ScheduleConnector>;
  email?: EmailConfig | undefined;
}

export function createAppDeps(): AppDeps {
  const env = loadEnv();
  const logger = createLogger({ module: 'api' });
  const pool = createPool(env.databaseUrl);
  const llm = createFallbackLlmClient(env, logger);
  const fetchTool = createLinkedinMcpClient(logger);
  const youtubeTranscriptTool = createYoutubeTranscriptMcpClient(logger);

  const publishConnectors: Record<string, PublishConnector> = {};
  const scheduleConnectors: Record<string, ScheduleConnector> = {};
  if (env.buffer) {
    publishConnectors.x = createBufferPublishConnector(env.buffer, logger);
    scheduleConnectors.x = createXScheduleConnector();
  }
  if (env.blogGit) {
    publishConnectors.blog = createBlogGitPublishConnector(env.blogGit, logger);
    scheduleConnectors.blog = createBlogGitScheduleConnector();
  }

  return {
    env,
    pool,
    llm,
    fetchTool,
    youtubeTranscriptTool,
    logger,
    publishConnectors,
    scheduleConnectors,
    email: env.email,
  };
}

function closeable(
  connector: PublishConnector | ScheduleConnector,
): connector is (PublishConnector | ScheduleConnector) & { close: () => Promise<void> } {
  return typeof (connector as { close?: unknown }).close === 'function';
}

export async function closeAppDeps(deps: AppDeps): Promise<void> {
  const connectorCloses = [
    ...Object.values(deps.publishConnectors),
    ...Object.values(deps.scheduleConnectors),
  ]
    .filter(closeable)
    .map((connector) => connector.close());
  await Promise.all([
    deps.fetchTool.close(),
    deps.youtubeTranscriptTool.close(),
    deps.pool.end(),
    ...connectorCloses,
  ]);
}
