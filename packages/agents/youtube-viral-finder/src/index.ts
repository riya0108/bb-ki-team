import { createLogger, loadLlmProviders, newRunId, newStepId } from '@ai-company/core';
import { TrendSignalSchema, type FindYoutubeSignalsTaskPayload, type TrendSignal } from '@ai-company/shared-types';
import { connectYoutube } from './mcpClient.js';
import { searchVideos } from './pipeline/searchVideos.js';
import { computeOutlierScores } from './pipeline/computeOutlierScores.js';
import { classifySignals } from './pipeline/classifySignals.js';

const MAX_CLASSIFIED = 12;

export async function runYoutubeViralFinderAgent(
  payload: FindYoutubeSignalsTaskPayload,
): Promise<TrendSignal[]> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });

  logger.info('youtube-viral-finder agent started', { candidateTopics: payload.candidateTopics.length });

  const youtube = await connectYoutube();
  try {
    const searchStepId = newStepId('search_videos');
    const found = await searchVideos(youtube, payload.candidateTopics, logger.child({ stepId: searchStepId }));
    logger.info('videos found', { stepId: searchStepId, count: found.length });

    if (found.length === 0) return [];

    const outlierStepId = newStepId('compute_outlier_scores');
    const scored = await computeOutlierScores(youtube, found);
    scored.sort((a, b) => b.outlierScore - a.outlierScore);
    const topScored = scored.slice(0, MAX_CLASSIFIED);
    logger.info('outlier scores computed', {
      stepId: outlierStepId,
      topOutlierScore: topScored[0]?.outlierScore ?? 0,
    });

    const classified = await classifySignals(providers, topScored);
    const classifiedByIndex = new Map(classified.map((c) => [c.index, c]));

    const now = new Date().toISOString();
    const signals: TrendSignal[] = topScored.flatMap((c, i) => {
      const info = classifiedByIndex.get(i);
      if (!info) return [];
      return [
        TrendSignalSchema.parse({
          id: newStepId('yt_signal'),
          type: 'trending_topic',
          platform: 'youtube',
          title: c.title,
          description: info.description,
          evidenceUrl: c.url,
          momentum: info.momentum,
          // Best-effort proxy for velocity: a single fetch has no historical
          // view-count series to measure true velocity from (see classifySignals.ts).
          velocityScore: c.outlierScore,
          discoveredAt: now,
          sourceType: 'youtube',
          outlierScore: c.outlierScore,
          ...(c.subscriberCount !== undefined ? { audienceSize: c.subscriberCount } : {}),
        }),
      ];
    });

    logger.info('signals classified', { count: signals.length });
    return signals;
  } finally {
    await youtube.close();
  }
}
