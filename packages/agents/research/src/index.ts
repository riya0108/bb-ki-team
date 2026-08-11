import { createLogger, loadLlmProviders, newRunId, newStepId } from '@ai-company/core';
import {
  ResearchAgentOutputSchema,
  type MomentumState,
  type ResearchAgentOutput,
  type Source,
  type TrendSignal,
} from '@ai-company/shared-types';
import { connectSearchSources, closeSearchSources } from './mcpClient.js';
import { planSearchQueries } from './pipeline/planSearchQueries.js';
import { search } from './pipeline/search.js';
import { dedupeSources } from './pipeline/dedupe.js';
import { evaluateRelevance } from './pipeline/evaluateRelevance.js';
import { foldTrendSignals } from './pipeline/foldTrendSignals.js';
import { scoreTopics } from './pipeline/scoreTopics.js';
import { verifyTopics } from './pipeline/verify.js';

export interface RunResearchAgentOptions {
  /** Ranked opportunity signals from the Trend Research agent, if this run was chained after it. */
  trendSignals?: TrendSignal[];
}

/** The topic's momentum is its highest-velocity supporting signal's — a topic can't be "rising" on weak evidence. */
function topicMomentum(signals: TrendSignal[]): MomentumState | undefined {
  if (signals.length === 0) return undefined;
  return [...signals].sort((a, b) => b.velocityScore - a.velocityScore)[0]?.momentum;
}

function emptyOutput(userQuery: string, runId: string): ResearchAgentOutput {
  return ResearchAgentOutputSchema.parse({
    query: userQuery,
    runId,
    generatedAt: new Date().toISOString(),
    topics: [],
  });
}

export async function runResearchAgent(
  userQuery: string,
  options: RunResearchAgentOptions = {},
): Promise<ResearchAgentOutput> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });
  const trendSignals = options.trendSignals ?? [];

  logger.info('research agent started', { query: userQuery, trendSignalCount: trendSignals.length });

  const searchSources = await connectSearchSources(logger);
  logger.info('search sources connected', { sources: searchSources.map((s) => s.id) });

  try {
    const planStepId = newStepId('plan_search_queries');
    const plan = await planSearchQueries(providers, userQuery);
    logger.info('search plan generated', { stepId: planStepId, queryCount: plan.queries.length });

    const searchStepId = newStepId('search');
    const rawSources = await search(searchSources, plan, logger.child({ stepId: searchStepId }));
    logger.info('search complete', { stepId: searchStepId, sourceCount: rawSources.length });

    const dedupeStepId = newStepId('dedupe');
    const dedupedSources = dedupeSources(rawSources);
    logger.info('sources deduped', {
      stepId: dedupeStepId,
      before: rawSources.length,
      after: dedupedSources.length,
    });

    if (dedupedSources.length === 0) {
      logger.warn('no sources found for query', { stepId: dedupeStepId });
      return emptyOutput(userQuery, runId);
    }

    const knownUrls = new Set(dedupedSources.map((s) => s.url));
    const sourcesByUrl = new Map(dedupedSources.map((s) => [s.url, s]));

    const evalStepId = newStepId('evaluate_relevance');
    const clusters = await evaluateRelevance(providers, userQuery, dedupedSources);
    const validClusters = clusters.topics
      .map((t) => ({ ...t, sourceUrls: t.sourceUrls.filter((url) => knownUrls.has(url)) }))
      .filter((t) => t.sourceUrls.length > 0);
    logger.info('topics clustered', {
      stepId: evalStepId,
      topicCount: validClusters.length,
      discarded: clusters.topics.length - validClusters.length,
    });

    if (validClusters.length === 0) {
      logger.warn('no verifiably relevant topics found', { stepId: evalStepId });
      return emptyOutput(userQuery, runId);
    }

    const foldStepId = newStepId('fold_trend_signals');
    const topicsWithSignals = foldTrendSignals(validClusters, trendSignals);
    logger.info('trend signals folded', {
      stepId: foldStepId,
      matchedTopics: topicsWithSignals.filter((t) => t.supportingSignals.length > 0).length,
    });

    const scoreStepId = newStepId('score_topics');
    const scored = await scoreTopics(providers, userQuery, topicsWithSignals);
    logger.info('topics scored', { stepId: scoreStepId, scoredCount: scored.topics.length });

    const toVerify = scored.topics
      .map((s) => {
        const cluster = topicsWithSignals[s.index];
        if (!cluster) return undefined;
        return {
          topic: cluster.topic,
          score: s.score,
          reason: s.reason,
          recommendation: s.recommendation,
          supportingSignals: cluster.supportingSignals,
          momentum: topicMomentum(cluster.supportingSignals),
          sources: cluster.sourceUrls
            .map((url) => sourcesByUrl.get(url))
            .filter((source): source is Source => source !== undefined),
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== undefined);

    const verifyStepId = newStepId('verify');
    const verification = await verifyTopics(
      providers,
      toVerify.map((t) => ({ topic: t.topic, reason: t.reason, sources: t.sources })),
    );
    const verificationByIndex = new Map(verification.verifications.map((v) => [v.index, v]));

    const finalTopics = toVerify
      .map((t, i) => {
        const v = verificationByIndex.get(i);
        if (!v?.verified || v.groundedReason.trim().length === 0) return undefined;
        return {
          topic: t.topic,
          score: t.score,
          reason: v.groundedReason,
          recommendation: t.recommendation,
          ...(t.momentum ? { momentum: t.momentum } : {}),
          supportingSignals: t.supportingSignals,
          sources: t.sources.map((s) => s.url),
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .sort((a, b) => b.score - a.score);

    logger.info('verification complete', {
      stepId: verifyStepId,
      verifiedCount: finalTopics.length,
      droppedCount: toVerify.length - finalTopics.length,
    });

    return ResearchAgentOutputSchema.parse({
      query: userQuery,
      runId,
      generatedAt: new Date().toISOString(),
      topics: finalTopics,
    });
  } finally {
    await closeSearchSources(searchSources);
  }
}

export type { ResearchAgentOutput };
