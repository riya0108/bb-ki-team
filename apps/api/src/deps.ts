import type { Env, LlmClient, Logger } from '@bb/core';
import { createFallbackLlmClient, createLogger, loadEnv } from '@bb/core';
import type { Pool } from '@bb/db';
import { createPool } from '@bb/db';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import { createLinkedinMcpClient, createYoutubeTranscriptMcpClient } from '@bb/mcp-client';
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
  // Keyed by platform. Empty until Phase 3's real connectors are built — every
  // publish/schedule request honestly fails and is logged rather than pretending
  // to succeed (CLAUDE.md: never fabricate success; spec 15.4).
  publishConnectors: Record<string, PublishConnector>;
  scheduleConnectors: Record<string, ScheduleConnector>;
}

export function createAppDeps(): AppDeps {
  const env = loadEnv();
  const logger = createLogger({ module: 'api' });
  const pool = createPool(env.databaseUrl);
  const llm = createFallbackLlmClient(env, logger);
  const fetchTool = createLinkedinMcpClient(logger);
  const youtubeTranscriptTool = createYoutubeTranscriptMcpClient(logger);
  return {
    env,
    pool,
    llm,
    fetchTool,
    youtubeTranscriptTool,
    logger,
    publishConnectors: {},
    scheduleConnectors: {},
  };
}

export async function closeAppDeps(deps: AppDeps): Promise<void> {
  await Promise.all([deps.fetchTool.close(), deps.youtubeTranscriptTool.close(), deps.pool.end()]);
}
