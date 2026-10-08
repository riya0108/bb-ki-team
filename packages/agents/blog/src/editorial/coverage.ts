import type { BlogArticleIndexEntry, Queryable } from '@bb/db';
import { listBlogArticleIndex } from '@bb/db';
import { contentStems, sharedStemCount } from '@bb/qa-gate';
import type { CoverageCheck, InternalLink } from '@bb/shared-types';

import type { InternalLinkCandidate } from '../draftArticle.js';

// Spec 35/47/48: before planning, check what Bull or Bear has already written — so the
// planner can choose a new angle or recommend an update instead of duplicating an
// article — and find genuinely related published articles to link to.

const PRIOR_COVERAGE_THRESHOLD = 0.45;
const LINK_RELEVANCE_THRESHOLD = 0.2;
const LINKABLE_STATUSES = new Set(['published']);

function similarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  return sharedStemCount(a, b) / Math.min(a.length, b.length);
}

function entryStems(e: BlogArticleIndexEntry): string[] {
  return contentStems([e.title, e.topic ?? '', e.thesis ?? '', e.primaryAngle ?? ''].join(' '));
}

export interface CoverageContext {
  coverage: CoverageCheck;
  linkCandidates: InternalLinkCandidate[];
}

export function assessCoverage(index: readonly BlogArticleIndexEntry[], topic: string, topicKey: string | null): CoverageContext {
  const topicStems = contentStems(topic);
  const scored = index.map((e) => ({
    entry: e,
    score: e.topicKey !== null && topicKey !== null && e.topicKey === topicKey ? 1 : similarity(topicStems, entryStems(e)),
  }));
  const matches = scored
    .filter((s) => s.score >= PRIOR_COVERAGE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => ({
      contentId: s.entry.contentId,
      title: s.entry.title,
      slug: s.entry.slug,
      status: s.entry.status,
      thesis: s.entry.thesis,
      createdAt: s.entry.createdAt,
      similarity: Math.round(s.score * 100) / 100,
    }));
  const linkCandidates = scored
    .filter((s) => LINKABLE_STATUSES.has(s.entry.status) && s.entry.publishedUrl !== null && s.score >= LINK_RELEVANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => ({ contentId: s.entry.contentId, title: s.entry.title, url: s.entry.publishedUrl ?? '', thesis: s.entry.thesis }));
  return { coverage: { status: matches.length > 0 ? 'previously_covered' : 'new_topic', matches }, linkCandidates };
}

export async function loadCoverageContext(db: Queryable, topic: string, topicKey: string | null): Promise<CoverageContext> {
  return assessCoverage(await listBlogArticleIndex(db), topic, topicKey);
}

export function renderCoverageForPlanner(coverage: CoverageCheck): string {
  if (coverage.matches.length === 0) return 'PRIOR COVERAGE: none found — this is a new topic for Bull or Bear.';
  return `PRIOR COVERAGE — Bull or Bear has already written about this. Do not duplicate a previous topic + angle
+ thesis. Choose priorCoverageDecision: new_angle (a genuinely different thesis), minor_update / major_update
(the old piece needs refreshing with new developments), no_update_needed (nothing material changed), or
new_article (the overlap is superficial).
${coverage.matches.map((m) => `- "${m.title}" (${m.status}, ${m.createdAt.slice(0, 10)}, similarity ${m.similarity})${m.thesis ? ` — thesis: ${m.thesis}` : ''}`).join('\n')}`;
}

// Keeps only the writer's links that point at an offered candidate and whose anchor
// text actually occurs in the article body (spec 35: never force links).
export function resolveInternalLinks(
  requested: readonly { anchorText: string; targetContentId: string; reason: string }[],
  candidates: readonly InternalLinkCandidate[],
  bodyText: string,
  index: readonly { contentId: string; slug: string }[] = [],
): InternalLink[] {
  const byId = new Map(candidates.map((c) => [c.contentId, c]));
  const slugById = new Map(index.map((e) => [e.contentId, e.slug]));
  const seen = new Set<string>();
  const out: InternalLink[] = [];
  for (const link of requested) {
    const target = byId.get(link.targetContentId);
    if (!target || seen.has(target.contentId) || !bodyText.includes(link.anchorText.trim()) || link.anchorText.trim().length < 3) continue;
    seen.add(target.contentId);
    out.push({
      anchorText: link.anchorText.trim(),
      targetContentId: target.contentId,
      targetTitle: target.title,
      targetSlug: slugById.get(target.contentId) ?? '',
      targetUrl: target.url,
      reason: link.reason,
    });
  }
  return out;
}
