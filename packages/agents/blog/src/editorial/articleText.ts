import type { DraftBlogArticleWriterOutput } from '../draftArticle.js';

import type { ArticleShape } from './styleMetrics.js';

// Plain-text views of a structured draft. QA, meaning-drift, slop and critic checks
// all judge the article's words — including every word inside a table, quiz, flip
// card or decision reveal, since those are published claims too — never markup.

export interface ComponentText {
  type: string;
  // Text that states facts (cells, answers, explanations, reveals) — checked against
  // the verified claims.
  factual: string[];
  // Text that is deliberately not a claim (wrong quiz options, poll/decision labels).
  nonFactual: string[];
  claimIds: string[];
}

export function componentTexts(d: DraftBlogArticleWriterOutput): ComponentText[] {
  const out: ComponentText[] = [];
  if (d.table) {
    out.push({
      type: 'table',
      factual: [...d.table.rows.flat(), d.table.footnote ?? ''].filter((t) => t.length > 0),
      nonFactual: [d.table.title, d.table.subtitle ?? '', ...d.table.columns.map((c) => c.label), d.table.sourceNote].filter((t) => t.length > 0),
      claimIds: d.table.claimIds,
    });
  }
  if (d.quiz) {
    out.push({
      type: 'quiz',
      factual: d.quiz.questions.flatMap((q) => [q.options[q.correctOptionIndex] ?? '', q.explanation]).filter((t) => t.length > 0),
      nonFactual: d.quiz.questions.flatMap((q) => [q.question, ...q.options.filter((_, i) => i !== q.correctOptionIndex)]),
      claimIds: d.quiz.questions.flatMap((q) => q.claimIds),
    });
  }
  if (d.decision) {
    out.push({
      type: 'decision',
      factual: d.decision.options.flatMap((o) => [o.revealText, o.evidenceNote ?? '']).filter((t) => t.length > 0),
      nonFactual: [d.decision.title, d.decision.question, ...d.decision.options.flatMap((o) => [o.label, o.revealTitle])],
      claimIds: d.decision.claimIds,
    });
  }
  if (d.timeline) {
    out.push({
      type: 'timeline',
      factual: d.timeline.events.flatMap((e) => [`${e.date}: ${e.title}`, e.description]),
      nonFactual: [d.timeline.title],
      claimIds: d.timeline.claimIds,
    });
  }
  if (d.revealCards) {
    out.push({
      type: 'revealCards',
      factual: d.revealCards.cards.flatMap((c) => [c.number ?? '', c.title, c.text]).filter((t) => t.length > 0),
      nonFactual: [d.revealCards.title, ...d.revealCards.cards.map((c) => c.teaser)],
      claimIds: [],
    });
  }
  if (d.comparisonStat) {
    const c = d.comparisonStat;
    out.push({
      type: 'comparisonStat',
      factual: [`${c.leftValue} ${c.leftCaption}`, `${c.rightValue} ${c.rightCaption}`, c.footnote],
      nonFactual: [c.label],
      claimIds: [],
    });
  }
  if (d.poll) {
    out.push({
      type: 'poll',
      factual: d.poll.options.map((o) => o.revealText),
      nonFactual: [d.poll.question, ...d.poll.options.map((o) => o.label)],
      claimIds: [],
    });
  }
  if (d.pullQuote) out.push({ type: 'pullQuote', factual: [d.pullQuote.text], nonFactual: [], claimIds: [] });
  return out;
}

export function presentComponentTypes(d: DraftBlogArticleWriterOutput): string[] {
  return componentTexts(d).map((c) => c.type);
}

// The article's prose only (title through conclusion), in reading order.
export function articleProse(d: DraftBlogArticleWriterOutput): string {
  return [
    d.titleOptions[0] ?? '',
    d.deck,
    ...(d.shortVersion ?? []),
    ...d.sections.map((sec) => `${sec.heading}\n${sec.body}`),
    d.practicalTakeaway ?? '',
    d.conclusion,
  ]
    .filter((t) => t.length > 0)
    .join('\n\n');
}

// Everything a reader will see as text, for QA's fact/meaning checks.
export function articlePlainText(d: DraftBlogArticleWriterOutput): string {
  const components = componentTexts(d)
    .filter((c) => c.type !== 'pullQuote')
    .map((c) => c.factual.join('\n'))
    .filter((t) => t.length > 0);
  return [articleProse(d), ...components].join('\n\n');
}

export function openingOf(d: DraftBlogArticleWriterOutput): string {
  const firstBody = d.sections[0]?.body ?? '';
  return firstBody.split(/\n{2,}/).slice(0, 2).join('\n\n');
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function slopInputOf(d: DraftBlogArticleWriterOutput): { opening: string; body: string; ending: string; headings: string[] } {
  return {
    opening: openingOf(d),
    body: [
      (d.sections[0]?.body ?? '').split(/\n{2,}/).slice(2).join('\n\n'),
      ...d.sections.slice(1).map((s) => s.body),
      d.practicalTakeaway ?? '',
    ].join('\n\n'),
    ending: d.conclusion,
    headings: d.sections.map((s) => s.heading),
  };
}

export function shapeOfDraft(d: DraftBlogArticleWriterOutput): ArticleShape {
  const paragraphs = [...d.sections.map((s) => s.body), d.practicalTakeaway ?? '', d.conclusion]
    .flatMap((b) => b.split(/\n{2,}/))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const components = presentComponentTypes(d);
  return {
    headings: d.sections.map((s) => s.heading),
    paragraphs,
    opening: openingOf(d),
    ending: d.conclusion,
    tableCount: d.table ? 1 : 0,
    componentCount: components.length,
  };
}
