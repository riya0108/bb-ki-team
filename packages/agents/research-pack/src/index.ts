import {
  createLogger,
  loadLlmProviders,
  newRunId,
  newStepId,
  resolveCompetitorYoutubeChannelIds,
} from '@ai-company/core';
import { ResearchPackSchema, type ResearchPack, type Source } from '@ai-company/shared-types';
import { connectSearchSources, closeSearchSources, type SearchSource } from './mcpClient.js';
import { planDeepQueries } from './pipeline/planDeepQueries.js';
import { search, searchBroadTopic } from './pipeline/search.js';
import { dedupeSources } from './pipeline/dedupe.js';
import { evidenceTypeForSource, extractResearchPack } from './pipeline/extractResearchPack.js';

export interface RunResearchPackAgentInput {
  topic: string;
  angle: string;
  modificationNote?: string;
}

function resolveSource(sources: Source[], index: number): Source | undefined {
  return sources[index];
}

const MAX_EXTRACTION_SOURCES = 20;

/**
 * Caps how many sources are shown to the extraction LLM call — a small
 * model's per-minute token budget can't absorb 70+ full source listings.
 * Tracked-competitor sources are prioritized (the whole point of tracking
 * them) up to half the budget, filling the rest with everything else.
 * Downstream sourceIndex resolution must use this exact same list, not the
 * full deduped list, or indices would point at the wrong source.
 */
function selectSourcesForExtraction(sources: Source[], maxCount: number): Source[] {
  const tracked = sources.filter((s) => s.isTrackedCompetitor);
  const untracked = sources.filter((s) => !s.isTrackedCompetitor);
  const trackedBudget = Math.min(tracked.length, Math.ceil(maxCount / 2));
  return [...tracked.slice(0, trackedBudget), ...untracked.slice(0, maxCount - trackedBudget)];
}

/** Tags competitor-blog and tracked-competitor-YouTube results — drives contentGap analysis. */
function tagTrackedCompetitors(sources: Source[], competitorChannelIds: Set<string>): Source[] {
  return sources.map((source) => {
    const isTrackedCompetitor =
      source.sourceType === 'competitor' ||
      (source.sourceType === 'youtube' && source.channelId !== undefined && competitorChannelIds.has(source.channelId));
    return isTrackedCompetitor ? { ...source, isTrackedCompetitor: true } : source;
  });
}

export async function runResearchPackAgent(input: RunResearchPackAgentInput): Promise<ResearchPack> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });

  logger.info('research-pack agent started', { topic: input.topic });

  const searchSources = await connectSearchSources(logger);
  logger.info('search sources connected', { sources: searchSources.map((s) => s.id) });

  try {
    const youtubeSource: SearchSource | undefined = searchSources.find((s) => s.id === 'youtube');
    const competitorChannelIds = await resolveCompetitorYoutubeChannelIds(youtubeSource, logger);

    const planStepId = newStepId('plan_deep_queries');
    const plan = await planDeepQueries(providers, input.topic, input.angle, input.modificationNote);
    logger.info('deep search plan generated', { stepId: planStepId, queryCount: plan.queries.length });

    const searchStepId = newStepId('search');
    const rawSources = await search(searchSources, plan, logger.child({ stepId: searchStepId }));

    const hackernewsSource = searchSources.find((s) => s.id === 'hackernews');
    const broadSources = hackernewsSource
      ? await searchBroadTopic(hackernewsSource, input.topic, logger.child({ stepId: searchStepId }))
      : [];

    logger.info('search complete', {
      stepId: searchStepId,
      sourceCount: rawSources.length + broadSources.length,
    });

    const dedupedSources = tagTrackedCompetitors(
      dedupeSources([...rawSources, ...broadSources]),
      competitorChannelIds,
    );
    logger.info('sources deduped', {
      before: rawSources.length,
      after: dedupedSources.length,
      trackedCompetitorHits: dedupedSources.filter((s) => s.isTrackedCompetitor).length,
    });

    if (dedupedSources.length === 0) {
      throw new Error(`research-pack agent: no sources found for topic "${input.topic}"`);
    }

    const extractionSources = selectSourcesForExtraction(dedupedSources, MAX_EXTRACTION_SOURCES);
    logger.info('sources selected for extraction', {
      selected: extractionSources.length,
      trackedCompetitorSelected: extractionSources.filter((s) => s.isTrackedCompetitor).length,
    });

    const extractStepId = newStepId('extract_research_pack');
    const extracted = await extractResearchPack(providers, input.topic, input.angle, extractionSources);
    logger.info('research pack extracted', {
      stepId: extractStepId,
      facts: extracted.facts.length,
      statistics: extracted.statistics.length,
      expertQuotes: extracted.expertQuotes.length,
    });

    const facts = extracted.facts.flatMap(({ claim, value, sourceIndex, confidence }) => {
      const source = resolveSource(extractionSources, sourceIndex);
      if (!source) return [];
      return [
        {
          claim,
          ...(value !== undefined ? { value } : {}),
          source: source.url,
          sourceType: evidenceTypeForSource(source),
          ...(source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {}),
          confidence,
          verified: true,
        },
      ];
    });
    const statistics = extracted.statistics.flatMap(({ stat, value, sourceIndex, confidence }) => {
      const source = resolveSource(extractionSources, sourceIndex);
      if (!source) return [];
      return [
        {
          stat,
          ...(value !== undefined ? { value } : {}),
          source: source.url,
          sourceType: evidenceTypeForSource(source),
          ...(source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {}),
          confidence,
          verified: true,
        },
      ];
    });
    const expertQuotes = extracted.expertQuotes.flatMap(({ quote, attribution, sourceIndex }) => {
      const source = resolveSource(extractionSources, sourceIndex);
      return source ? [{ quote, attribution, source: source.url }] : [];
    });

    const counterargumentSource = resolveSource(extractionSources, extracted.counterargument.sourceIndex);
    const counterargument = {
      dominantNarrative: extracted.counterargument.dominantNarrative,
      strongestCounterEvidence: extracted.counterargument.strongestCounterEvidence,
      source: (counterargumentSource ?? extractionSources[0])!.url,
    };

    return ResearchPackSchema.parse({
      runId,
      topic: input.topic,
      generatedAt: new Date().toISOString(),
      facts,
      statistics,
      expertQuotes,
      counterargument,
      causalAnalysis: extracted.causalAnalysis,
      historicalPrecedent: extracted.historicalPrecedent,
      contentGap: extracted.contentGap,
      recommendedStructure: extracted.recommendedStructure,
      sources: extractionSources,
    });
  } finally {
    await closeSearchSources(searchSources);
  }
}

export type { ResearchPack };
