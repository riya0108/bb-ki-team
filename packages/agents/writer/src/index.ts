import { z } from 'zod';
import { createLogger, loadLlmProviders, newRunId, type Logger } from '@ai-company/core';
import { BlogDraftSchema, type BlogDraft, type WriteDraftTaskPayload } from '@ai-company/shared-types';
import { reviseDraft, writeDraft } from './pipeline/writeDraft.js';
import { connectStyleSamples, type StyleSample } from './mcpClient.js';

const GetStyleSamplesResultSchema = z.object({
  samples: z.array(z.object({ title: z.string(), bodyExcerpt: z.string() })),
});

const STYLE_SAMPLE_COUNT = 3;
const MIN_WORD_COUNT = 900;
const MAX_WORD_COUNT = 1150;

function citedSourceUrls(researchPack: WriteDraftTaskPayload['researchPack']): string[] {
  const urls = new Set<string>();
  for (const f of researchPack.facts) urls.add(f.source);
  for (const s of researchPack.statistics) urls.add(s.source);
  for (const q of researchPack.expertQuotes) urls.add(q.source);
  urls.add(researchPack.counterargument.source);
  if (urls.size === 0) {
    for (const s of researchPack.sources) urls.add(s.url);
  }
  return [...urls];
}

function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length;
}

async function fetchStyleSamples(logger: Logger): Promise<StyleSample[]> {
  const mcp = await connectStyleSamples();
  try {
    const raw = await mcp.callTool('get_style_samples', { count: STYLE_SAMPLE_COUNT });
    const { samples } = GetStyleSamplesResultSchema.parse(raw);
    logger.info('style samples fetched', { count: samples.length });
    return samples;
  } finally {
    await mcp.close();
  }
}

export async function runWriterAgent(payload: WriteDraftTaskPayload): Promise<BlogDraft> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });

  logger.info('writer agent started', { topic: payload.topic, isRevision: payload.revision !== undefined });

  const styleSamples = await fetchStyleSamples(logger);

  const draft = payload.revision
    ? await reviseDraft(
        providers,
        payload.topic,
        payload.researchPack,
        payload.revision.previousDraft.content,
        payload.revision.feedback,
        { styleSamples },
        payload.modificationNote,
      )
    : await writeDraft(providers, payload.topic, payload.researchPack, { styleSamples }, payload.modificationNote);

  const draftVersion = payload.revision ? payload.revision.previousDraft.draftVersion + 1 : 1;
  const draftWordCount = wordCount(draft.content);

  if (draftWordCount < MIN_WORD_COUNT || draftWordCount > MAX_WORD_COUNT) {
    logger.warn('draft word count outside target range', {
      wordCount: draftWordCount,
      target: `${String(MIN_WORD_COUNT)}-${String(MAX_WORD_COUNT)}`,
    });
  }

  logger.info('draft generated', { draftVersion, wordCount: draftWordCount });

  return BlogDraftSchema.parse({
    runId,
    draftVersion,
    title: draft.title,
    ...(draft.seoTitle ? { seoTitle: draft.seoTitle } : {}),
    excerpt: draft.excerpt,
    content: draft.content,
    wordCount: draftWordCount,
    sources: citedSourceUrls(payload.researchPack),
    generatedAt: new Date().toISOString(),
  });
}

export type { BlogDraft };
