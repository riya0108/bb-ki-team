import { createLogger, loadLlmProviders, newRunId, newStepId } from '@ai-company/core';
import {
  BlogCandidatesOutputSchema,
  computeWeightedTotal,
  type BlogCandidatesOutput,
  type EditorialCategory,
} from '@ai-company/shared-types';
import { connectSearchSources, closeSearchSources, connectArchive } from './mcpClient.js';
import { loadArchiveIntelligence } from './pipeline/loadArchiveIntelligence.js';
import { planEditorialQueries } from './pipeline/planEditorialQueries.js';
import { search } from './pipeline/search.js';
import { fetchCompetitorDigest } from './pipeline/fetchCompetitorDigest.js';
import { dedupeSources } from './pipeline/dedupe.js';
import { capSourcesRoundRobin } from './pipeline/selectSources.js';
import { generateCandidates } from './pipeline/generateCandidates.js';
import { scoreCandidates } from './pipeline/scoreCandidates.js';

export interface RunBlogTopicFinderAgentOptions {
  focusCategory?: EditorialCategory;
  /**
   * Feedback text from past "changes_requested" decisions at the 'topic'
   * gate — the "Do Not Recommend" learning signal (plan §45/46). Fetched by
   * apps/worker via @ai-company/db (agent packages have no DB access) and
   * threaded in here, the same way trendSignals is threaded into `research`.
   */
  rejectionFeedback?: string[];
}

const MAX_FINAL_CANDIDATES = 10;
/**
 * Caps how many sources are shown to the candidate-generation/scoring LLM
 * calls — a live run with the full deduped set (87 sources across 5 source
 * types + 10 queries) requested 18,914 tokens against Groq's 12K TPM free-
 * tier limit and failed on every configured provider. Mirrors research-pack's
 * MAX_EXTRACTION_SOURCES cap for the same reason.
 */
const MAX_SOURCES_FOR_GENERATION = 24;
/**
 * Reserves most of MAX_SOURCES_FOR_GENERATION's budget for real, current
 * competitor content (fetchCompetitorDigest.ts) — the whole point of the
 * digest is that it's the LLM's PRIMARY material, so it must not get
 * crowded out by the higher-volume generic search results the same way
 * Wikipedia used to crowd out everything else pre-capSourcesRoundRobin.
 */
const MAX_DIGEST_SOURCES = 16;

export async function runBlogTopicFinderAgent(
  options: RunBlogTopicFinderAgentOptions = {},
): Promise<BlogCandidatesOutput> {
  const providers = loadLlmProviders();
  const runId = newRunId();
  const logger = createLogger({ runId });
  const rejectionFeedback = options.rejectionFeedback ?? [];

  logger.info('blog-topic-finder agent started', {
    focusCategory: options.focusCategory,
    rejectionFeedbackCount: rejectionFeedback.length,
  });

  const searchSources = await connectSearchSources(logger);
  const archive = await connectArchive();
  logger.info('sources connected', { sources: searchSources.map((s) => s.id) });

  try {
    const archiveStepId = newStepId('load_archive_intelligence');
    const { posts: archivePosts, contentDna } = await loadArchiveIntelligence(providers, archive);
    logger.info('archive intelligence loaded', { stepId: archiveStepId, postCount: archivePosts.length });

    const planStepId = newStepId('plan_editorial_queries');
    const plan = await planEditorialQueries(
      providers,
      options.focusCategory,
      archivePosts.map((p) => p.title),
    );
    logger.info('editorial search plan generated', { stepId: planStepId, queryCount: plan.queries.length });

    const searchStepId = newStepId('search');
    const digestStepId = newStepId('fetch_competitor_digest');
    const [rawSources, digestSources] = await Promise.all([
      search(searchSources, plan, logger.child({ stepId: searchStepId })),
      fetchCompetitorDigest(searchSources, logger.child({ stepId: digestStepId })),
    ]);
    const dedupedSources = dedupeSources(rawSources);
    const cappedDigest = capSourcesRoundRobin(digestSources, MAX_DIGEST_SOURCES);
    const cappedGeneric = capSourcesRoundRobin(
      dedupedSources.filter((s) => !cappedDigest.some((d) => d.url === s.url)),
      MAX_SOURCES_FOR_GENERATION - cappedDigest.length,
    );
    const cappedSources = [...cappedDigest, ...cappedGeneric];
    logger.info('search complete', {
      stepId: searchStepId,
      before: rawSources.length,
      afterDedupe: dedupedSources.length,
      digestFetched: digestSources.length,
      digestUsed: cappedDigest.length,
      genericUsed: cappedGeneric.length,
    });

    if (cappedSources.length === 0) {
      throw new Error('blog-topic-finder agent: no sources found across the editorial universe');
    }

    const generateStepId = newStepId('generate_candidates');
    const drafts = await generateCandidates(providers, {
      sources: cappedSources,
      archivePosts,
      rejectionFeedback,
      ...(options.focusCategory ? { focusCategory: options.focusCategory } : {}),
    });
    logger.info('candidates generated', { stepId: generateStepId, count: drafts.length });

    if (drafts.length === 0) {
      throw new Error('blog-topic-finder agent: no viable candidates survived overlap filtering');
    }

    const scoreStepId = newStepId('score_candidates');
    const scored = await scoreCandidates(providers, drafts, archivePosts);
    logger.info('candidates scored', { stepId: scoreStepId, count: scored.length });

    const scoredByIndex = new Map(scored.map((s) => [s.index, s]));

    const candidates = drafts.flatMap((draft, i) => {
      const score = scoredByIndex.get(i);
      if (!score) return [];
      const sources = draft.sourceIndexes.flatMap((si) => (cappedSources[si] ? [cappedSources[si]] : []));
      return [
        {
          topic: draft.topic,
          category: draft.category,
          angle: draft.angle,
          titleConcepts: draft.titleConcepts,
          scoreBreakdown: score.scoreBreakdown,
          totalScore: computeWeightedTotal(score.scoreBreakdown),
          reason: score.reason,
          risk: score.risk,
          whyNow: draft.whyNow,
          trendLifecycle: draft.trendLifecycle,
          overlapStatus: draft.overlapStatus,
          contentGapNote: draft.contentGapNote,
          internalLinkCandidates: score.internalLinkCandidates,
          sources,
        },
      ];
    });

    candidates.sort((a, b) => b.totalScore - a.totalScore);

    return BlogCandidatesOutputSchema.parse({
      runId,
      generatedAt: new Date().toISOString(),
      contentDna,
      candidates: candidates.slice(0, MAX_FINAL_CANDIDATES),
    });
  } finally {
    await closeSearchSources(searchSources);
    await archive.close();
  }
}
