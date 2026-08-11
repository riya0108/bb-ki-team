import { createLogger, loadLlmProviders, newRunId, newStepId } from '@ai-company/core';
import { TrendSignalSchema, type FindInstagramSignalsTaskPayload, type TrendSignal } from '@ai-company/shared-types';
import { connectInstagram } from './mcpClient.js';
import { searchPosts } from './pipeline/searchPosts.js';
import { classifySignals } from './pipeline/classifySignals.js';

/**
 * Fully autonomous, like youtube-viral-finder — searches Instagram's indexed
 * content via Brave Search (see packages/mcp-servers/search-instagram) and
 * classifies the results, no manual data-supply step required. Replaces the
 * earlier design where raw candidates had to be fetched via vidIQ's
 * Instagram/TikTok outlier tools during an interactive session and pasted in
 * through an approval gate — that only worked when a human was present;
 * this runs unattended via the task queue like every other agent.
 */
export async function runInstagramViralFinderAgent(
  payload: FindInstagramSignalsTaskPayload,
): Promise<TrendSignal[]> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });

  logger.info('instagram-viral-finder agent started', { candidateTopics: payload.candidateTopics.length });

  const instagram = await connectInstagram();
  try {
    const searchStepId = newStepId('search_posts');
    const found = await searchPosts(instagram, payload.candidateTopics, logger.child({ stepId: searchStepId }));
    logger.info('posts found', { stepId: searchStepId, count: found.length });

    if (found.length === 0) return [];

    const classifyStepId = newStepId('classify_signals');
    const classified = await classifySignals(providers, found);
    logger.info('signals classified', { stepId: classifyStepId, count: classified.length });

    const now = new Date().toISOString();
    const signals: TrendSignal[] = classified.flatMap((c) => {
      const post = found[c.index];
      if (!post) return [];
      return [
        TrendSignalSchema.parse({
          id: newStepId('ig_signal'),
          type: 'trending_topic',
          platform: 'instagram',
          title: post.title,
          description: c.description,
          evidenceUrl: post.url,
          momentum: c.momentum,
          velocityScore: c.velocityScore,
          discoveredAt: now,
          sourceType: 'instagram',
        }),
      ];
    });

    return signals;
  } finally {
    await instagram.close();
  }
}
