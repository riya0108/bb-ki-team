import { z } from 'zod';
import { EDITORIAL_UNIVERSE, type Source } from '@ai-company/shared-types';
import { resolveCompetitorYoutubeChannelIds, type Logger } from '@ai-company/core';
import type { SearchSource } from '../mcpClient.js';

const WebSearchOutputSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      description: z.string(),
      publishedAt: z.string().optional(),
      channelId: z.string().optional(),
    }),
  ),
});

const MAX_CATEGORIES_SWEPT = 5;
const RESULTS_PER_CATEGORY = 6;
const MAX_CHANNELS = 15;
const VIDEOS_PER_CHANNEL = 3;

/**
 * Fetches what tracked competitors have ACTUALLY published/uploaded
 * recently — a deterministic recency sweep (Brave `freshness=pw` + real
 * channel uploads via `list_channel_videos`), never LLM-guessed queries.
 * This is the "check the blog sites, check the YouTube video titles"
 * grounding: generateCandidates.ts uses these real titles as its primary
 * material for finding a differentiated angle/gap, instead of only
 * reacting to whatever planEditorialQueries' generic brainstormed queries
 * happen to surface.
 */
export async function fetchCompetitorDigest(sources: SearchSource[], logger: Logger): Promise<Source[]> {
  const competitorSource = sources.find((s) => s.id === 'competitor');
  const youtubeSource = sources.find((s) => s.id === 'youtube');

  const [blogHits, videoHits] = await Promise.all([
    fetchCompetitorBlogSweep(competitorSource, logger),
    fetchCompetitorVideoSweep(youtubeSource, logger),
  ]);

  logger.info('competitor digest fetched', { blogHits: blogHits.length, videoHits: videoHits.length });

  const seen = new Set<string>();
  return [...blogHits, ...videoHits].filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

async function fetchCompetitorBlogSweep(competitorSource: SearchSource | undefined, logger: Logger): Promise<Source[]> {
  if (!competitorSource) return [];

  const sweepCategories = [...EDITORIAL_UNIVERSE].sort((a, b) => b.weight - a.weight).slice(0, MAX_CATEGORIES_SWEPT);

  const settled = await Promise.allSettled(
    sweepCategories.map(async (profile) => {
      const query = profile.subtopics.slice(0, 3).join(' ');
      const raw = await competitorSource.callTool('web_search', {
        query,
        count: RESULTS_PER_CATEGORY,
        freshness: 'pw',
      });
      return WebSearchOutputSchema.parse(raw).results;
    }),
  );

  const hits: Source[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      logger.warn('competitor blog recency sweep failed for one category, skipping', {
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
      continue;
    }
    for (const r of outcome.value) {
      hits.push({
        url: r.url,
        title: r.title,
        snippet: r.description,
        searchQuery: 'competitor recency sweep',
        sourceType: 'competitor',
        isTrackedCompetitor: true,
        ...(r.publishedAt !== undefined ? { publishedAt: r.publishedAt } : {}),
      });
    }
  }
  return hits;
}

async function fetchCompetitorVideoSweep(youtubeSource: SearchSource | undefined, logger: Logger): Promise<Source[]> {
  if (!youtubeSource) return [];

  const channelIds = [...(await resolveCompetitorYoutubeChannelIds(youtubeSource, logger))].slice(0, MAX_CHANNELS);
  if (channelIds.length === 0) return [];

  try {
    const raw = await youtubeSource.callTool('list_channel_videos', {
      channelIds,
      perChannel: VIDEOS_PER_CHANNEL,
    });
    const { results } = WebSearchOutputSchema.parse(raw);
    return results.map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.description,
      searchQuery: 'competitor recency sweep',
      sourceType: 'youtube',
      isTrackedCompetitor: true,
      ...(r.publishedAt !== undefined ? { publishedAt: r.publishedAt } : {}),
      ...(r.channelId !== undefined ? { channelId: r.channelId } : {}),
    }));
  } catch (error) {
    logger.warn('competitor YouTube channel video sweep failed, skipping', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
