import { randomUUID } from 'node:crypto';
import { createLogger, loadLlmProviders, newRunId, newStepId } from '@ai-company/core';
import {
  TrendResearchAgentOutputSchema,
  type MomentumState,
  type SourceType,
  type TrendResearchAgentOutput,
  type TrendSignal,
} from '@ai-company/shared-types';
import { connectSearchSources, closeSearchSources } from './mcpClient.js';
import { planSearchQueries } from './pipeline/planSearchQueries.js';
import { gatherSignals } from './pipeline/gatherSignals.js';
import { dedupeCandidates, rankAndCapCandidates } from './pipeline/dedupe.js';
import { scoreMomentum } from './pipeline/scoreMomentum.js';
import { extractHooks } from './pipeline/extractHooks.js';
import { verifySignals, type SignalDraft } from './pipeline/verifySignals.js';

interface DraftWithMeta extends SignalDraft {
  platform: string;
  momentum: MomentumState;
  velocityScore: number;
  sourceType: SourceType;
}

function emptyOutput(topic: string, runId: string): TrendResearchAgentOutput {
  return TrendResearchAgentOutputSchema.parse({
    topic,
    runId,
    generatedAt: new Date().toISOString(),
    signals: [],
  });
}

export async function runTrendResearchAgent(topic: string): Promise<TrendResearchAgentOutput> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });

  logger.info('trend research agent started', { topic });

  const sources = await connectSearchSources(logger);
  logger.info('signal sources connected', { sources: sources.map((s) => s.id) });

  try {
    const planStepId = newStepId('plan_search_queries');
    const plan = await planSearchQueries(providers, topic);
    logger.info('search plan generated', { stepId: planStepId, queryCount: plan.queries.length });

    const gatherStepId = newStepId('gather_signals');
    const rawCandidates = await gatherSignals(
      sources,
      plan,
      logger.child({ stepId: gatherStepId }),
    );
    logger.info('signals gathered', { stepId: gatherStepId, candidateCount: rawCandidates.length });

    const dedupeStepId = newStepId('dedupe');
    const candidates = dedupeCandidates(rawCandidates);
    logger.info('candidates deduped', {
      stepId: dedupeStepId,
      before: rawCandidates.length,
      after: candidates.length,
    });

    if (candidates.length === 0) {
      logger.warn('no candidates found for topic', { stepId: dedupeStepId });
      return emptyOutput(topic, runId);
    }

    // Rank + cap before any LLM call: an uncapped candidate set (broad
    // topics can gather 40+) risks the model drifting off-schema partway
    // through a long structured-output response.
    const rankedCandidates = rankAndCapCandidates(candidates);
    logger.info('candidates ranked and capped', {
      stepId: dedupeStepId,
      before: candidates.length,
      after: rankedCandidates.length,
    });

    const momentumStepId = newStepId('score_momentum');
    const momentum = await scoreMomentum(providers, topic, rankedCandidates);
    logger.info('momentum scored', {
      stepId: momentumStepId,
      scoredCount: momentum.signals.length,
    });

    const hooksStepId = newStepId('extract_hooks');
    const hooks = await extractHooks(providers, topic, rankedCandidates);
    logger.info('hooks extracted', { stepId: hooksStepId, hookCount: hooks.hooks.length });

    const drafts: DraftWithMeta[] = [];

    for (const m of momentum.signals) {
      const candidate = rankedCandidates[m.index];
      if (!candidate) continue;
      // Don't trust the LLM's classification over the ground truth: a
      // candidate is only ever "competitor_post" if it actually came from
      // the competitor source, and never that type otherwise.
      const type =
        candidate.sourceType === 'competitor'
          ? 'competitor_post'
          : m.type === 'competitor_post'
            ? 'trending_topic'
            : m.type;
      drafts.push({
        type,
        title: candidate.title,
        description: m.rationale,
        evidenceUrl: candidate.url,
        evidenceSnippet: candidate.description,
        platform: candidate.platform ?? candidate.sourceType,
        momentum: m.momentum,
        velocityScore: m.velocityScore,
        sourceType: candidate.sourceType,
      });
    }

    for (const h of hooks.hooks) {
      const example = rankedCandidates[h.exampleIndex];
      if (!example) continue;
      drafts.push({
        type: 'hook',
        title: h.title,
        description: h.description,
        evidenceUrl: example.url,
        evidenceSnippet: example.description,
        platform: example.platform ?? example.sourceType,
        momentum: h.momentum,
        velocityScore: h.velocityScore,
        sourceType: example.sourceType,
      });
    }

    if (drafts.length === 0) {
      logger.warn('no signal drafts produced', { stepId: momentumStepId });
      return emptyOutput(topic, runId);
    }

    const verifyStepId = newStepId('verify_signals');
    const verification = await verifySignals(providers, drafts);
    const verificationByIndex = new Map(verification.verifications.map((v) => [v.index, v]));

    const now = new Date().toISOString();
    const finalSignals: TrendSignal[] = drafts
      .map((d, i): TrendSignal | undefined => {
        const v = verificationByIndex.get(i);
        if (!v?.verified || v.groundedDescription.trim().length === 0) return undefined;
        return {
          id: randomUUID(),
          type: d.type,
          platform: d.platform,
          title: d.title,
          description: v.groundedDescription,
          evidenceUrl: d.evidenceUrl,
          momentum: d.momentum,
          velocityScore: d.velocityScore,
          discoveredAt: now,
          sourceType: d.sourceType,
        };
      })
      .filter((s): s is TrendSignal => s !== undefined)
      .sort((a, b) => b.velocityScore - a.velocityScore);

    logger.info('verification complete', {
      stepId: verifyStepId,
      verifiedCount: finalSignals.length,
      droppedCount: drafts.length - finalSignals.length,
    });

    return TrendResearchAgentOutputSchema.parse({
      topic,
      runId,
      generatedAt: now,
      signals: finalSignals,
    });
  } finally {
    await closeSearchSources(sources);
  }
}

export type { TrendResearchAgentOutput };
