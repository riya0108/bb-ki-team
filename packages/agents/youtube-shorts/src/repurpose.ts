import type { LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import type { FetchTool, YoutubeTranscriptTool } from '@bb/mcp-client';
import { FetchToolError } from '@bb/mcp-client';
import type { ContentDnaRecord, YoutubeShortPackage } from '@bb/shared-types';
import { z } from 'zod';

import { RepurposeSourceInaccessibleError, YoutubeTranscriptUnavailableError } from './errors.js';
import { runYoutubeShort } from './headAgent.js';

export type ShortsSource =
  | { kind: 'url'; url: string }
  | { kind: 'text'; label: string; text: string }
  | { kind: 'youtube'; videoUrl: string };

const IdeaExtractionSchema = z.object({
  topic: z.string(),
  angle: z.string(),
  coreClaim: z.string().nullable(),
});

function buildIdeaExtractionSystemPrompt(dna: ContentDnaRecord): string {
  return `You are Agent 04 — the Bull or Bear YouTube Shorts Content Head Agent, identifying one
self-contained idea from a longer source (spec 11.1: "if the source is a long video, choose the
strongest self-contained idea rather than automatically cutting the first segment"; 11.2: "identify
one self-contained idea"). Pick the single strongest angle, not a summary of everything in the
source. It must make sense to someone who has never seen the source material.

Creator's Content DNA:
- Primary topics: ${dna.topics.primary.join(', ') || 'none noted'}
- Topics to avoid: ${dna.topics.avoid.join(', ') || 'none noted'}`;
}

async function extractSelfContainedIdea(
  sourceText: string,
  dna: ContentDnaRecord,
  llm: LlmClient,
  runId: string,
): Promise<{ topic: string; angle: string; coreClaim: string | null }> {
  return llm.completeStructured(
    {
      system: buildIdeaExtractionSystemPrompt(dna),
      messages: [{ role: 'user', content: sourceText.slice(0, 8000) }],
      runId,
      stepId: 'extract-self-contained-idea',
    },
    IdeaExtractionSchema,
  );
}

async function resolveSourceText(
  source: ShortsSource,
  fetchTool: FetchTool,
  youtubeTranscriptTool: YoutubeTranscriptTool,
): Promise<{ text: string; reference: string }> {
  if (source.kind === 'text') return { text: source.text, reference: source.label };

  if (source.kind === 'youtube') {
    try {
      const result = await youtubeTranscriptTool.fetchTranscript(source.videoUrl);
      return { text: result.text, reference: source.videoUrl };
    } catch (error) {
      if (error instanceof FetchToolError) {
        throw new YoutubeTranscriptUnavailableError(source.videoUrl, error.message);
      }
      throw error;
    }
  }

  try {
    const result = await fetchTool.fetchUrl(source.url);
    return { text: result.text, reference: source.url };
  } catch (error) {
    if (error instanceof FetchToolError) {
      throw new RepurposeSourceInaccessibleError(source.url, error.message);
    }
    throw error;
  }
}

export interface RunYoutubeShortFromSourceInput {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  youtubeTranscriptTool: YoutubeTranscriptTool;
  source: ShortsSource;
  runId: string;
}

// Spec 11.2's full workflow starting from "source/topic/video transcript" rather than
// an already-chosen topic/angle: fetches the source, has the model identify the one
// self-contained idea worth a Short, then drafts through the same pipeline as
// runYoutubeShort.
export async function runYoutubeShortFromSource(input: RunYoutubeShortFromSourceInput): Promise<YoutubeShortPackage> {
  const { pool, llm, fetchTool, youtubeTranscriptTool, source, runId } = input;

  const { text: sourceText, reference } = await resolveSourceText(source, fetchTool, youtubeTranscriptTool);

  const dna = await loadCurrentDna(pool);
  const idea = await extractSelfContainedIdea(sourceText, dna, llm, runId);

  return runYoutubeShort({
    pool,
    llm,
    topic: idea.topic,
    angle: idea.angle,
    coreClaim: idea.coreClaim,
    sourceTexts: [sourceText],
    sourceReferences: [reference],
    runId,
  });
}
