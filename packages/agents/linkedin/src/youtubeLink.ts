import type { Logger, LlmClient } from '@bb/core';
import type { Pool } from '@bb/db';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import { FetchToolError } from '@bb/mcp-client';
import type { LinkedinPackage } from '@bb/shared-types';

import { YoutubeTranscriptUnavailableError } from './errors.js';
import { runRepurpose } from './repurpose.js';

export interface RunYoutubeLinkInput {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  youtubeTranscriptTool: YoutubeTranscriptTool;
  videoUrl: string;
  logger: Logger;
  runId: string;
  postCount?: number;
}

// Spec 5.1 YouTube Link row ("turn this video into LinkedIn content" -> transcript/idea
// extraction -> original post(s)). Extraction of the transcript itself lives in
// packages/mcp-servers/youtube-transcript (an unofficial, no-API-key caption fetch);
// once we have plain text, drafting is identical to any other repurpose source.
export async function runYoutubeLink(input: RunYoutubeLinkInput): Promise<LinkedinPackage[]> {
  let transcriptText: string;
  try {
    const result = await input.youtubeTranscriptTool.fetchTranscript(input.videoUrl);
    transcriptText = result.text;
  } catch (error) {
    if (error instanceof FetchToolError) {
      throw new YoutubeTranscriptUnavailableError(input.videoUrl, error.message);
    }
    throw error;
  }

  return runRepurpose({
    pool: input.pool,
    llm: input.llm,
    fetchTool: input.fetchTool,
    source: { kind: 'text', label: input.videoUrl, text: transcriptText },
    mode: 'youtube_link',
    logger: input.logger,
    runId: input.runId,
    ...(input.postCount !== undefined ? { postCount: input.postCount } : {}),
  });
}
