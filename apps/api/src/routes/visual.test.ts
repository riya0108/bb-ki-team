import type { Logger } from '@bb/core';
import type { LlmClient } from '@bb/core';
import type { Pool } from '@bb/db';
import type { FetchTool, ImageGenTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import { describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { AppDeps } from '../deps.js';

const noopLogger = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const unusedPool = {} as unknown as Pool;
const unusedLlm = {} as unknown as LlmClient;
const unusedFetchTool = {} as unknown as FetchTool;
const unusedYoutubeTool = {} as unknown as YoutubeTranscriptTool;
const unusedImageGen = {} as unknown as ImageGenTool;

function buildDeps(visualAgentEnabled: boolean): AppDeps {
  return {
    env: { databaseUrl: 'x', apiPort: 0, apiHost: '127.0.0.1', visualAgentEnabled },
    pool: unusedPool,
    llm: unusedLlm,
    fetchTool: unusedFetchTool,
    youtubeTranscriptTool: unusedYoutubeTool,
    imageGen: unusedImageGen,
    logger: noopLogger,
    publishConnectors: {},
    scheduleConnectors: {},
  };
}

// T01 (text-only regression): the visual stage must never even attempt to run
// (never touch the DB/LLM/image provider) when BB_VISUAL_AGENT_ENABLED is false —
// this is the flag-gate itself, so it deliberately needs no real Postgres/LLM,
// unlike runVisualStage's own integration tests (packages/agents/visual).
describe('POST /visual/:contentId/generate feature flag gate', () => {
  it('returns 403 and never touches pool/llm/imageGen when the flag is off', async () => {
    const app = createApp(buildDeps(false));
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const res = await fetch(
        `http://127.0.0.1:${port}/visual/11111111-1111-4111-8111-111111111111/generate`,
        {
          method: 'POST',
        },
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('VisualAgentDisabled');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
