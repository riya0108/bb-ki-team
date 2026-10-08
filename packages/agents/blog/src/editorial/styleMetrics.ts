import { extractQuantities, splitSentences } from '@bb/qa-gate';
import type { StyleMetrics } from '@bb/shared-types';

// Measurable style traits (spec 10): computed the same way for a Bull or Bear draft, an
// approved article's HTML and a supplied reference article, so the Blog Style Profile
// compares like with like. Pure functions over text — no article text is ever stored,
// only these numbers.

export interface ArticleShape {
  headings: string[];
  paragraphs: string[];
  opening: string;
  ending: string;
  tableCount: number;
  componentCount: number;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places;

export function classifyOpening(opening: string): StyleMetrics['openingStyle'] {
  const first = splitSentences(opening)[0] ?? '';
  if (/\?\s*$/.test(first) || opening.slice(0, 220).includes('?')) return 'question';
  if (/^(last|this|on a|one|when i|i |my |we )/i.test(first) || /\b(I|my|we)\b/.test(first)) return 'anecdote';
  if (extractQuantities(first).some((q) => q.unit !== 'year' && (q.unit !== 'plain' || q.value >= 10))) return 'statistic';
  if (/\b(but|yet|however|despite|although|even though)\b/i.test(opening.slice(0, 300))) return 'tension';
  if (/\b(than|versus|vs\.?|compared)\b/i.test(first)) return 'contrast';
  if (/\b(announced|said|launched|cut|raised|hiked|reported|fell|rose|won|lost|filed)\b/i.test(first)) return 'event';
  return 'other';
}

export function classifyEnding(ending: string): StyleMetrics['endingStyle'] {
  const sentences = splitSentences(ending);
  const last = sentences[sentences.length - 1] ?? '';
  if (last.endsWith('?')) return 'question';
  if (/\b(uncomfortable|the problem is|nobody|no one|awkward|the catch)\b/i.test(ending)) return 'uncomfortable_observation';
  if (/\b(you should|check|consider|start by|before you|ask your)\b/i.test(ending)) return 'action';
  if (/\b(will likely|is likely|expect|next (year|quarter|month)|if this continues|watch)\b/i.test(ending)) return 'prediction';
  if (/\b(means|implies|suggests|so the real|which is why)\b/i.test(ending)) return 'implication';
  if (sentences.length > 0) return 'synthesis';
  return 'other';
}

export function computeStyleMetrics(shape: ArticleShape): StyleMetrics {
  const allText = shape.paragraphs.join('\n\n');
  const sentences = splitSentences(allText);
  const totalWords = words(allText).length;
  const paragraphWords = shape.paragraphs.map((p) => words(p).length).filter((n) => n > 0);
  const lines = allText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const per1000 = (n: number): number => (totalWords === 0 ? 0 : round((n / totalWords) * 1000, 1));
  return {
    wordCount: totalWords,
    openingWordCount: words(shape.opening).length,
    openingStyle: classifyOpening(shape.opening),
    avgSentenceWords: round(mean(sentences.map((s) => words(s).length)), 1),
    avgParagraphWords: round(mean(paragraphWords), 1),
    shortParagraphRatio: paragraphWords.length === 0 ? 0 : round(paragraphWords.filter((n) => n <= 35).length / paragraphWords.length),
    h2Count: shape.headings.length,
    questionH2Ratio: shape.headings.length === 0 ? 0 : round(shape.headings.filter((h) => h.trim().endsWith('?')).length / shape.headings.length),
    numbersPer1000Words: per1000(extractQuantities(allText).filter((q) => q.unit !== 'plain' || q.value >= 10).length),
    questionsPer1000Words: per1000(sentences.filter((s) => s.endsWith('?')).length),
    tableCount: shape.tableCount,
    componentCount: shape.componentCount,
    bulletLineRatio: lines.length === 0 ? 0 : round(lines.filter((l) => /^([-*•]|\d+[.)])\s/.test(l)).length / lines.length),
    endingStyle: classifyEnding(shape.ending),
  };
}

// Shape of plain reference text (a pasted article): blank-line paragraphs, short
// unpunctuated lines treated as headings.
export function shapeFromPlainText(text: string): ArticleShape {
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  const isHeading = (b: string): boolean => !b.includes('\n') && words(b).length <= 14 && !/[.!]$/.test(b) && b.length < 110;
  const headings = blocks.filter(isHeading);
  const paragraphs = blocks.filter((b) => !isHeading(b));
  return {
    headings,
    paragraphs,
    opening: paragraphs.slice(0, 2).join('\n\n'),
    ending: paragraphs[paragraphs.length - 1] ?? '',
    tableCount: 0,
    componentCount: 0,
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rarr;/g, '→')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

export interface ArticleHtmlAnalysis {
  title: string;
  shape: ArticleShape;
  sections: { heading: string; paragraphs: string[] }[];
  components: string[];
}

// Reads back the structure of an article assembled by htmlBuilder.ts (including one a
// human edited by hand in the dashboard) — used to diff an AI draft against what was
// finally approved, and to measure approved articles for the style profile.
export function analyzeArticleHtml(html: string): ArticleHtmlAnalysis {
  const title = stripTags(/<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '');
  const main = /<main class="essay">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? html;
  // Widgets are measured as components, not prose.
  const prose = main
    .replace(/<aside class="short-version"[\s\S]*?<\/aside>/g, '')
    .replace(/<(figure|div) class="(table-figure|gap-widget|reveal-wrap|quiz|poll|decision|timeline-wrap)"[\s\S]*?(?=<section|<\/main>|$)/g, '');
  const sectionMatches = [...prose.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/g)];
  const sections = sectionMatches.map((m) => {
    const inner = m[1] ?? '';
    const heading = stripTags(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(inner)?.[1] ?? '');
    const paragraphs = [...inner.matchAll(/<p(?: class="[^"]*")?>([\s\S]*?)<\/p>/g)]
      .filter((p) => !/^<p class="(source-note|disclaimer)"/.test(p[0]))
      .map((p) => stripTags(p[1] ?? ''))
      .filter((p) => p.length > 0);
    return { heading, paragraphs };
  });
  const components = [
    ...(main.includes('<figure class="table-figure">') ? ['table'] : []),
    ...(main.includes('<div class="gap-widget">') ? ['comparisonStat'] : []),
    ...(main.includes('<div class="timeline-wrap">') ? ['timeline'] : []),
    ...(main.includes('<div class="reveal-wrap">') ? ['revealCards'] : []),
    ...(main.includes('<div class="decision">') ? ['decision'] : []),
    ...(main.includes('<div class="quiz">') ? ['quiz'] : []),
    ...(main.includes('<div class="poll">') ? ['poll'] : []),
    ...(main.includes('<blockquote>') ? ['pullQuote'] : []),
  ];
  const bodySections = sections.filter((s) => s.heading !== 'Bottom line');
  const conclusion = sections.find((s) => s.heading === 'Bottom line');
  const allParagraphs = sections.flatMap((s) => s.paragraphs);
  return {
    title,
    sections,
    components,
    shape: {
      headings: bodySections.map((s) => s.heading).filter((h) => h !== 'What this means for you'),
      paragraphs: allParagraphs,
      opening: (bodySections[0]?.paragraphs ?? []).slice(0, 2).join('\n\n'),
      ending: (conclusion?.paragraphs ?? []).join('\n\n'),
      tableCount: components.includes('table') ? 1 : 0,
      componentCount: components.length,
    },
  };
}
