import { createLogger, loadLlmProviders, newRunId, newStepId } from '@ai-company/core';
import {
  ResearchAgentOutputSchema,
  type ResearchAgentOutput,
  type SynthesizeContentStrategyTaskPayload,
} from '@ai-company/shared-types';
import { crossReferenceSignals } from './pipeline/crossReferenceSignals.js';
import { adjustAndRank, toScoredTopic } from './pipeline/adjustAndRank.js';

const FINAL_TOPIC_COUNT = 3;

/**
 * The convergence point of the Content Intelligence department (plan's org
 * chart): blog-topic-finder's candidates + youtube-viral-finder's +
 * instagram-viral-finder's signals come together here. Output is a plain
 * ResearchAgentOutput — the same shape the existing `research` agent
 * produces — so it flows through the existing 'topic' approval gate and
 * everything downstream (research-pack -> writer -> blog-publisher)
 * completely unchanged.
 */
export async function runContentStrategyAgent(
  payload: SynthesizeContentStrategyTaskPayload,
): Promise<ResearchAgentOutput> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });

  logger.info('content-strategy agent started', {
    blogCandidates: payload.blogCandidates.length,
    youtubeSignals: payload.youtubeSignals.length,
    instagramSignals: payload.instagramSignals.length,
  });

  const withSources = payload.blogCandidates.filter((c) => c.sources.length > 0);
  if (withSources.length < payload.blogCandidates.length) {
    logger.warn('dropped candidates with no resolvable sources', {
      dropped: payload.blogCandidates.length - withSources.length,
    });
  }
  if (withSources.length === 0) {
    throw new Error('content-strategy agent: no blog candidates with resolvable sources to synthesize');
  }

  const xrefStepId = newStepId('cross_reference_signals');
  const crossReferences = await crossReferenceSignals(
    providers,
    withSources,
    payload.youtubeSignals,
    payload.instagramSignals,
  );
  logger.info('signals cross-referenced', { stepId: xrefStepId, count: crossReferences.length });

  const rankStepId = newStepId('adjust_and_rank');
  const adjusted = adjustAndRank(
    withSources,
    crossReferences,
    payload.youtubeSignals,
    payload.instagramSignals,
    logger.child({ stepId: rankStepId }),
  );

  const topics = adjusted.slice(0, FINAL_TOPIC_COUNT).map(toScoredTopic);

  return ResearchAgentOutputSchema.parse({
    query: 'Content Intelligence: cross-platform blog topic synthesis',
    runId,
    generatedAt: new Date().toISOString(),
    topics,
  });
}
