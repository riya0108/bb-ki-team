import Groq from 'groq-sdk';
import { z } from 'zod';
import { createLogger, loadEnv, newRunId, newStepId } from '@ai-company/core';
import { ResearchAgentOutputSchema, type ResearchAgentOutput, type Source } from '@ai-company/shared-types';
import { connectSearchClient } from './mcpClient.js';
import { planSearchQueries } from './pipeline/planSearchQueries.js';
import { search } from './pipeline/search.js';
import { dedupeSources } from './pipeline/dedupe.js';
import { evaluateRelevance } from './pipeline/evaluateRelevance.js';
import { scoreTopics } from './pipeline/scoreTopics.js';
import { verifyTopics } from './pipeline/verify.js';

const EnvSchema = z.object({
  GROQ_API_KEY: z.string().min(1, 'GROQ_API_KEY is required to run the research agent'),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
});

function emptyOutput(userQuery: string, runId: string): ResearchAgentOutput {
  return ResearchAgentOutputSchema.parse({
    query: userQuery,
    runId,
    generatedAt: new Date().toISOString(),
    topics: [],
  });
}

export async function runResearchAgent(userQuery: string): Promise<ResearchAgentOutput> {
  const env = loadEnv(EnvSchema);
  const runId = newRunId();
  const logger = createLogger({ runId });
  const groq = new Groq({ apiKey: env.GROQ_API_KEY });

  logger.info('research agent started', { query: userQuery });

  const mcpClient = await connectSearchClient();

  try {
    const planStepId = newStepId('plan_search_queries');
    const plan = await planSearchQueries(groq, env.GROQ_MODEL, userQuery);
    logger.info('search plan generated', { stepId: planStepId, queryCount: plan.queries.length });

    const searchStepId = newStepId('search');
    const rawSources = await search(mcpClient, plan, logger.child({ stepId: searchStepId }));
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
    const clusters = await evaluateRelevance(groq, env.GROQ_MODEL, userQuery, dedupedSources);
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

    const scoreStepId = newStepId('score_topics');
    const scored = await scoreTopics(groq, env.GROQ_MODEL, userQuery, { topics: validClusters });
    logger.info('topics scored', { stepId: scoreStepId, scoredCount: scored.topics.length });

    const toVerify = scored.topics
      .map((s) => {
        const cluster = validClusters[s.index];
        if (!cluster) return undefined;
        return {
          topic: cluster.topic,
          score: s.score,
          reason: s.reason,
          sources: cluster.sourceUrls
            .map((url) => sourcesByUrl.get(url))
            .filter((source): source is Source => source !== undefined),
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== undefined);

    const verifyStepId = newStepId('verify');
    const verification = await verifyTopics(
      groq,
      env.GROQ_MODEL,
      toVerify.map((t) => ({ topic: t.topic, reason: t.reason, sources: t.sources })),
    );
    const verificationByIndex = new Map(verification.verifications.map((v) => [v.index, v]));

    const finalTopics = toVerify
      .map((t, i) => {
        const v = verificationByIndex.get(i);
        if (!v?.verified) return undefined;
        return {
          topic: t.topic,
          score: t.score,
          reason: v.groundedReason,
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
    await mcpClient.close();
  }
}

export type { ResearchAgentOutput };
