import { z } from 'zod';
import { computeOutlierScore } from '@ai-company/core';
import type { YoutubeMcp } from '../mcpClient.js';
import type { VideoCandidate } from './searchVideos.js';

const GetChannelStatsOutputSchema = z.object({
  channels: z.array(z.object({ channelId: z.string(), subscriberCount: z.number().optional() })),
});
const GetVideoStatsOutputSchema = z.object({
  videos: z.array(z.object({ videoId: z.string(), viewCount: z.number().optional() })),
});

export interface ScoredVideoCandidate extends VideoCandidate {
  viewCount?: number;
  subscriberCount?: number;
  /** views ÷ subscribers, log-scaled to 0-100 — see computeOutlierScore for the formula. */
  outlierScore: number;
}

function videoIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('v') ?? undefined;
  } catch {
    return undefined;
  }
}

export async function computeOutlierScores(
  youtube: YoutubeMcp,
  candidates: VideoCandidate[],
): Promise<ScoredVideoCandidate[]> {
  const videoIds = candidates.flatMap((c) => {
    const id = videoIdFromUrl(c.url);
    return id ? [id] : [];
  });
  const channelIds = candidates.flatMap((c) => (c.channelId ? [c.channelId] : []));

  const [videoStatsRaw, channelStatsRaw] = await Promise.all([
    youtube.callTool('get_video_stats', { videoIds }),
    youtube.callTool('get_channel_stats', { channelIds }),
  ]);
  const videoStats = new Map(
    GetVideoStatsOutputSchema.parse(videoStatsRaw).videos.map((v) => [v.videoId, v.viewCount]),
  );
  const channelStats = new Map(
    GetChannelStatsOutputSchema.parse(channelStatsRaw).channels.map((c) => [c.channelId, c.subscriberCount]),
  );

  return candidates.map((c) => {
    const id = videoIdFromUrl(c.url);
    const viewCount = id ? videoStats.get(id) : undefined;
    const subscriberCount = c.channelId ? channelStats.get(c.channelId) : undefined;
    return {
      ...c,
      ...(viewCount !== undefined ? { viewCount } : {}),
      ...(subscriberCount !== undefined ? { subscriberCount } : {}),
      outlierScore: computeOutlierScore(viewCount, subscriberCount),
    };
  });
}
