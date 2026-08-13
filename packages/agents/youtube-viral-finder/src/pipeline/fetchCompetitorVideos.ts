import { z } from 'zod';
import { resolveCompetitorYoutubeChannelIds, type Logger } from '@ai-company/core';
import type { YoutubeMcp } from '../mcpClient.js';
import type { VideoCandidate } from './searchVideos.js';

const ListChannelVideosOutputSchema = z.object({
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

const MAX_CHANNELS_PER_CALL = 15;
const VIDEOS_PER_CHANNEL = 5;

/**
 * Pulls actual recent uploads from the tracked-competitor channel list
 * (packages/core/src/competitorYoutubeChannels.ts) — not a keyword search,
 * so this is what "check the YouTube video titles" actually means: what
 * these specific creators have genuinely just posted, independent of
 * whatever candidateTopics the caller happened to supply.
 */
export async function fetchCompetitorVideos(youtube: YoutubeMcp, logger: Logger): Promise<VideoCandidate[]> {
  const channelIds = [...(await resolveCompetitorYoutubeChannelIds(youtube, logger))].slice(0, MAX_CHANNELS_PER_CALL);
  if (channelIds.length === 0) return [];

  try {
    const raw = await youtube.callTool('list_channel_videos', {
      channelIds,
      perChannel: VIDEOS_PER_CHANNEL,
    });
    const { results } = ListChannelVideosOutputSchema.parse(raw);
    return results
      .filter((r) => r.channelId !== undefined)
      .map((r) => ({
        title: r.title,
        url: r.url,
        description: r.description,
        matchedTopic: 'tracked competitor channel',
        ...(r.publishedAt !== undefined ? { publishedAt: r.publishedAt } : {}),
        channelId: r.channelId!,
      }));
  } catch (error) {
    logger.warn('fetching tracked competitor channel videos failed, skipping', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
