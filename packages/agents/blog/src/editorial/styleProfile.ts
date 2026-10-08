import type { Queryable } from '@bb/db';
import { listActiveStyleSamples } from '@bb/db';
import type { BlogStyleProfile, StyleMetrics, StyleSample } from '@bb/shared-types';

import { EDITORIAL_OBSERVATIONS } from '../draftArticle.js';

// Spec 10/11: the Blog Style Profile is measurable, not adjectives. It is aggregated
// on demand from abstracted style samples — Bull or Bear's own approved/published
// articles weigh double, approved references count once — so it evolves automatically
// as articles are approved, and the writer receives the profile, never copied text.

const OWN_KINDS = new Set(['approved_article', 'own_published']);

type NumericMetric = Exclude<keyof StyleMetrics, 'openingStyle' | 'endingStyle'>;
const NUMERIC: NumericMetric[] = [
  'wordCount',
  'openingWordCount',
  'avgSentenceWords',
  'avgParagraphWords',
  'shortParagraphRatio',
  'h2Count',
  'questionH2Ratio',
  'numbersPer1000Words',
  'questionsPer1000Words',
  'tableCount',
  'componentCount',
  'bulletLineRatio',
];

function weightOf(sample: StyleSample): number {
  return OWN_KINDS.has(sample.kind) ? 2 : 1;
}

function distribution(samples: readonly StyleSample[], pick: (s: StyleSample) => string): Record<string, number> {
  const totals: Record<string, number> = {};
  let sum = 0;
  for (const s of samples) {
    const key = pick(s);
    totals[key] = (totals[key] ?? 0) + weightOf(s);
    sum += weightOf(s);
  }
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round((v / sum) * 100) / 100]));
}

function topStrings(values: readonly string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values.map((x) => x.trim()).filter((x) => x.length > 0)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v]) => v);
}

function dominant(dist: Record<string, number>): [string, number] | null {
  return Object.entries(dist).sort((a, b) => b[1] - a[1])[0] ?? null;
}

export function aggregateStyleProfile(samples: readonly StyleSample[]): BlogStyleProfile {
  const active = samples.filter((s) => s.active);
  const own = active.filter((s) => OWN_KINDS.has(s.kind)).length;
  if (active.length === 0) {
    return { sampleCount: 0, ownArticleCount: 0, referenceCount: 0, metrics: null, traits: { openingTechniques: [], transitionPatterns: [], conclusionPatterns: [], voice: {} } };
  }
  const totalWeight = active.reduce((a, s) => a + weightOf(s), 0);
  const numeric = Object.fromEntries(
    NUMERIC.map((key) => [key, Math.round((active.reduce((a, s) => a + s.metrics[key] * weightOf(s), 0) / totalWeight) * 100) / 100]),
  ) as Record<NumericMetric, number>;
  const openingStyleDistribution = distribution(active, (s) => s.metrics.openingStyle);
  const endingStyleDistribution = distribution(active, (s) => s.metrics.endingStyle);

  const voiceKeys = ['conversationality', 'editorialDepth', 'directness', 'skepticism', 'warmth', 'formality'] as const;
  const voice: Record<string, number> = {};
  for (const key of voiceKeys) {
    const rated = active.filter((s) => s.traits[key] !== null && s.traits[key] !== undefined);
    if (rated.length === 0) continue;
    const w = rated.reduce((a, s) => a + weightOf(s), 0);
    voice[key] = Math.round((rated.reduce((a, s) => a + (s.traits[key] ?? 0) * weightOf(s), 0) / w) * 10) / 10;
  }

  return {
    sampleCount: active.length,
    ownArticleCount: own,
    referenceCount: active.length - own,
    metrics: {
      ...numeric,
      openingStyle: (dominant(openingStyleDistribution)?.[0] ?? 'other') as StyleMetrics['openingStyle'],
      endingStyle: (dominant(endingStyleDistribution)?.[0] ?? 'other') as StyleMetrics['endingStyle'],
      openingStyleDistribution,
      endingStyleDistribution,
    },
    traits: {
      openingTechniques: topStrings(active.map((s) => s.traits.openingTechnique ?? ''), 4),
      transitionPatterns: topStrings(active.flatMap((s) => s.traits.transitionPatterns), 6),
      conclusionPatterns: topStrings(active.map((s) => s.traits.conclusionPattern ?? ''), 4),
      voice,
    },
  };
}

export async function loadBlogStyleProfile(db: Queryable): Promise<BlogStyleProfile> {
  return aggregateStyleProfile(await listActiveStyleSamples(db));
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

function distLine(dist: Record<string, number>): string {
  return Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k.replace(/_/g, ' ')} ${pct(v)}`)
    .join(', ');
}

// What the writer receives: measured patterns to match (never text to copy). Falls
// back to the site's written editorial observations until samples exist.
export function renderStyleProfileForWriter(profile: BlogStyleProfile): string {
  if (!profile.metrics) {
    return `BLOG STYLE BASELINE (no approved articles or references measured yet — use the site's own
written editorial observations):
${EDITORIAL_OBSERVATIONS.map((o) => `- ${o}`).join('\n')}`;
  }
  const m = profile.metrics;
  const voice = Object.entries(profile.traits.voice)
    .map(([k, v]) => `${k} ${v}/10`)
    .join(', ');
  return `BLOG STYLE PROFILE — measured from ${profile.ownArticleCount} approved Bull or Bear article(s) and ${profile.referenceCount} approved reference(s).
Match these patterns; never copy any sentence, signature phrase or structure from a reference writer.
- Opening: ~${Math.round(m.openingWordCount)} words before the story is clear; styles used: ${distLine(m.openingStyleDistribution)}.
- Sentences ~${m.avgSentenceWords} words; paragraphs ~${m.avgParagraphWords} words; ${pct(m.shortParagraphRatio)} of paragraphs are short.
- Sections: ~${Math.round(m.h2Count)} H2s, ${pct(m.questionH2Ratio)} phrased as questions.
- Evidence: ~${m.numbersPer1000Words} figures per 1,000 words; tables in ${pct(Math.min(1, m.tableCount))} of articles; ~${m.componentCount} components per article.
- Bullets: ${pct(m.bulletLineRatio)} of lines (keep prose-led).
- Endings: ${distLine(m.endingStyleDistribution)}.
- Typical length: ~${Math.round(m.wordCount)} words (guidance only — depth decides).${
    profile.traits.openingTechniques.length > 0 ? `\n- Opening techniques that work: ${profile.traits.openingTechniques.join('; ')}.` : ''
  }${profile.traits.transitionPatterns.length > 0 ? `\n- Transition patterns: ${profile.traits.transitionPatterns.join('; ')}.` : ''}${
    profile.traits.conclusionPatterns.length > 0 ? `\n- Conclusion patterns: ${profile.traits.conclusionPatterns.join('; ')}.` : ''
  }${voice ? `\n- Voice: ${voice}.` : ''}`;
}
