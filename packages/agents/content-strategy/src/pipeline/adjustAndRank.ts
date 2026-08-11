import type { BlogCandidate, CrossPlatformScore, MomentumState, ScoredTopic, TrendSignal } from '@ai-company/shared-types';
import type { Logger } from '@ai-company/core';
import type { CrossReference } from './crossReferenceSignals.js';

const MAX_ADJUSTMENT = 10;
/** Below this deepDivePotential, social momentum never boosts the score — a viral meme is not a blog topic (plan §40/§43). */
const MIN_DEEP_DIVE_POTENTIAL = 50;
/** Below this blogRelevance (derived from the candidate's own audience/content-gap subscores), never boost either. */
const MIN_BLOG_RELEVANCE = 60;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function momentumFromSignals(signals: TrendSignal[]): MomentumState | undefined {
  if (signals.length === 0) return undefined;
  return [...signals].sort((a, b) => b.velocityScore - a.velocityScore)[0]?.momentum;
}

interface AdjustedCandidate {
  candidate: BlogCandidate;
  adjustedScore: number;
  crossPlatformScore: CrossPlatformScore;
  supportingSignals: TrendSignal[];
  crossPlatformNote: string;
}

/**
 * Applies a capped, documented cross-platform adjustment to each candidate's
 * score — never overriding the core 12-factor rubric, per the user's "don't
 * blindly follow social trends" note. googleSearch/blogRelevance are derived
 * deterministically from the candidate's own rubric subscores (already
 * LLM-scored by blog-topic-finder); only instagramTrend/youtubeTrend/
 * deepDivePotential come from crossReferenceSignals's LLM judgment.
 */
export function adjustAndRank(
  candidates: BlogCandidate[],
  crossReferences: CrossReference[],
  youtubeSignals: TrendSignal[],
  instagramSignals: TrendSignal[],
  logger: Logger,
): AdjustedCandidate[] {
  const crossRefByIndex = new Map(crossReferences.map((c) => [c.index, c]));

  const adjusted = candidates.map((candidate, i) => {
    const xref = crossRefByIndex.get(i);
    const googleSearch = candidate.scoreBreakdown.searchOpportunity;
    const blogRelevance = Math.round((candidate.scoreBreakdown.audienceRelevance + candidate.scoreBreakdown.contentGap) / 2);
    const instagramTrend = xref?.instagramTrend ?? 0;
    const youtubeTrend = xref?.youtubeTrend ?? 0;
    const deepDivePotential = xref?.deepDivePotential ?? 0;

    const crossPlatformScore: CrossPlatformScore = {
      instagramTrend,
      youtubeTrend,
      googleSearch,
      blogRelevance,
      deepDivePotential,
    };

    let adjustment = 0;
    if (deepDivePotential >= MIN_DEEP_DIVE_POTENTIAL && blogRelevance >= MIN_BLOG_RELEVANCE) {
      const socialSignal = (instagramTrend + youtubeTrend) / 2;
      adjustment = clamp(Math.round((socialSignal - 50) / 5), -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
    }

    const supportingSignals = [
      ...(xref?.matchedYoutubeSignalIndexes.flatMap((i2) => (youtubeSignals[i2] ? [youtubeSignals[i2]] : [])) ?? []),
      ...(xref?.matchedInstagramSignalIndexes.flatMap((i2) => (instagramSignals[i2] ? [instagramSignals[i2]] : [])) ?? []),
    ];

    return {
      candidate,
      adjustedScore: clamp(candidate.totalScore + adjustment, 0, 100),
      crossPlatformScore,
      supportingSignals,
      crossPlatformNote: xref?.note ?? 'No cross-platform signal available for this run.',
    };
  });

  adjusted.sort((a, b) => b.adjustedScore - a.adjustedScore);
  logger.info('candidates adjusted and ranked', {
    count: adjusted.length,
    topAdjustment: adjusted[0] ? adjusted[0].adjustedScore - adjusted[0].candidate.totalScore : 0,
  });
  return adjusted;
}

export function toScoredTopic(adjusted: AdjustedCandidate): ScoredTopic {
  const { candidate } = adjusted;
  return {
    topic: candidate.topic,
    score: adjusted.adjustedScore,
    reason: `${candidate.reason} ${adjusted.crossPlatformNote}`,
    sources: candidate.sources.map((s) => s.url),
    recommendation: candidate.angle,
    ...(momentumFromSignals(adjusted.supportingSignals) ? { momentum: momentumFromSignals(adjusted.supportingSignals) } : {}),
    supportingSignals: adjusted.supportingSignals,
    angle: candidate.angle,
    titleConcepts: candidate.titleConcepts,
    scoreBreakdown: candidate.scoreBreakdown,
    whyNow: candidate.whyNow,
    trendLifecycle: candidate.trendLifecycle,
    overlapStatus: candidate.overlapStatus,
    contentGapNote: candidate.contentGapNote,
    internalLinkCandidates: candidate.internalLinkCandidates,
    crossPlatformScore: adjusted.crossPlatformScore,
  };
}
