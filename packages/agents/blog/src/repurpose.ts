import type { LlmClient } from '@bb/core';
import type { Pool } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import { FetchToolError } from '@bb/mcp-client';
import type { BlogPackage } from '@bb/shared-types';

import { RepurposeSourceInaccessibleError } from './errors.js';
import { runBlogArticle } from './headAgent.js';

export type BlogSource = { kind: 'url'; url: string } | { kind: 'text'; label: string; text: string };

async function resolveSourceText(source: BlogSource, fetchTool: FetchTool): Promise<{ text: string; reference: string }> {
  if (source.kind === 'text') return { text: source.text, reference: source.label };
  try {
    const result = await fetchTool.fetchUrl(source.url);
    return { text: result.text, reference: source.url };
  } catch (error) {
    if (error instanceof FetchToolError) throw new RepurposeSourceInaccessibleError(source.url, error.message);
    throw error;
  }
}

export interface RunBlogArticleFromSourceInput {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  source: BlogSource;
  topic: string;
  sampleArticleTexts?: string[];
  runId: string;
}

// Spec 12.2's "Source-led article from PDF/video/article" mode.
export async function runBlogArticleFromSource(input: RunBlogArticleFromSourceInput): Promise<BlogPackage> {
  const { text, reference } = await resolveSourceText(input.source, input.fetchTool);

  return runBlogArticle({
    pool: input.pool,
    llm: input.llm,
    topic: input.topic,
    articleType: 'Source-led article',
    sourceTexts: [text],
    sourceReferences: [reference],
    ...(input.sampleArticleTexts !== undefined ? { sampleArticleTexts: input.sampleArticleTexts } : {}),
    runId: input.runId,
  });
}
