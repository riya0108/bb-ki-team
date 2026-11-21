// Deterministic structural checks against spec 12.5's HTML requirements. Runs on
// output this package itself assembled (htmlBuilder.ts), so these mostly guard
// against future changes to the builder rather than model misbehavior — the model
// never touches raw HTML directly (see htmlBuilder.ts's comment).

import { COMPONENT_LIMITS, INTERACTIVE_COMPONENT_TYPES, MAX_INTERACTIVE_WIDGETS } from '@bb/shared-types';
import type { ComponentType } from '@bb/shared-types';

import { INTERACTIVE_SCRIPT } from './htmlBuilder.js';

export interface BlogHtmlValidationResult {
  valid: boolean;
  issues: string[];
}

// The root class each builder widget renders with — used to count components.
const COMPONENT_MARKERS: Record<ComponentType, RegExp> = {
  table: /<figure class="table-figure">/g,
  revealCards: /<div class="reveal-wrap">/g,
  quiz: /<div class="quiz">/g,
  poll: /<div class="poll">/g,
  decision: /<div class="decision">/g,
  comparisonStat: /<div class="gap-widget">/g,
  pullQuote: /<blockquote>/g,
  timeline: /<div class="timeline-wrap">/g,
  barChart: /<figure class="bar-chart"/g,
};

// Inline pull quotes inside section bodies (bodyMarkup.ts's "> " blocks).
const MAX_INLINE_PULL_QUOTES = 3;

export function countComponents(html: string): Record<ComponentType, number> {
  return Object.fromEntries(
    (Object.keys(COMPONENT_MARKERS) as ComponentType[]).map((type) => [type, (html.match(COMPONENT_MARKERS[type]) ?? []).length]),
  ) as Record<ComponentType, number>;
}

function bodyOf(html: string): string {
  return /<main class="essay">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? html;
}

export function validateBlogHtml(html: string): BlogHtmlValidationResult {
  const issues: string[] = [];

  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  if (h1Count !== 1) {
    issues.push(`Expected exactly one <h1>, found ${h1Count}.`);
  }

  // htmlBuilder.ts emits at most one <script> tag, and its source is always exactly
  // INTERACTIVE_SCRIPT (never interpolated with model output) — anything else,
  // including an external `src=`, a tracking snippet, or injected content, fails.
  // Structured data (FAQPage/Article) is the one other script the builder emits: a
  // single inert application/ld+json block in <head> that must parse as JSON.
  const allScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  const isJsonLd = (attrs: string): boolean => /^\s*type="application\/ld\+json"\s*$/.test(attrs);
  const jsonLd = allScripts.filter((m) => isJsonLd(m[1] ?? ''));
  if (jsonLd.length > 1) issues.push(`Contains ${jsonLd.length} structured-data blocks — the builder emits at most one.`);
  const head = /<head>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  for (const match of jsonLd) {
    if (!head.includes(match[0])) issues.push('Structured data must sit in <head>.');
    try {
      JSON.parse(match[2] ?? '');
    } catch {
      issues.push('Structured data block is not valid JSON.');
    }
  }
  const scriptMatches = allScripts.filter((m) => !isJsonLd(m[1] ?? ''));
  if (scriptMatches.length > 1) {
    issues.push(`Contains ${scriptMatches.length} <script> tags — the builder emits at most one.`);
  }
  for (const match of scriptMatches) {
    const attrs = match[1] ?? '';
    const body = (match[2] ?? '').trim();
    if (/\bsrc\s*=/i.test(attrs)) {
      issues.push('Contains a <script src="..."> tag — never load external/tracking scripts (spec 12.5).');
    } else if (body !== INTERACTIVE_SCRIPT.trim()) {
      issues.push('Contains a <script> tag whose content is not the builder\'s known interactive script (spec 12.5).');
    }
  }

  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) {
    issues.push('Contains an inline event handler attribute — not allowed in article HTML.');
  }
  if (/<[a-z][^>]*(href|src)\s*=\s*"\s*(javascript|data|vbscript):/i.test(html)) {
    issues.push('Contains a javascript:/data:/vbscript: URL — not allowed in article HTML.');
  }
  if (/<(iframe|object|embed|form|input|textarea|svg|math|base|meta http-equiv)\b/i.test(bodyOf(html))) {
    issues.push('Article body contains an embedded/active element the builder never emits.');
  }

  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imgsMissingAlt = imgTags.filter((tag) => !/\balt\s*=\s*"[^"]*"/i.test(tag));
  if (imgsMissingAlt.length > 0) {
    issues.push(`${imgsMissingAlt.length} <img> tag(s) missing an alt attribute (spec 12.5).`);
  }

  const anchorIds = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const duplicateIds = anchorIds.filter((id, i) => anchorIds.indexOf(id) !== i);
  if (duplicateIds.length > 0) {
    issues.push(`Duplicate element id(s): ${[...new Set(duplicateIds)].join(', ')} — heading anchors must be unique.`);
  }

  // Component limits (spec 23): maximums per type, and a cap on click-to-answer widgets.
  const counts = countComponents(html);
  for (const [type, count] of Object.entries(counts) as [ComponentType, number][]) {
    if (count > COMPONENT_LIMITS[type]) issues.push(`Too many ${type} components: ${count} (max ${COMPONENT_LIMITS[type]}).`);
  }
  const pulls = (bodyOf(html).match(/<p class="pull">/g) ?? []).length;
  if (pulls > MAX_INLINE_PULL_QUOTES) issues.push(`Too many inline pull quotes: ${pulls} (max ${MAX_INLINE_PULL_QUOTES}).`);
  const interactive = INTERACTIVE_COMPONENT_TYPES.reduce((sum, t) => sum + counts[t], 0);
  if (interactive > MAX_INTERACTIVE_WIDGETS) {
    issues.push(`Too many interactive widgets: ${interactive} (max ${MAX_INTERACTIVE_WIDGETS}) — the article must not become a game.`);
  }
  if (interactive > 0 && scriptMatches.length === 0) {
    issues.push('Interactive widgets are present but the interaction script is missing.');
  }

  // Accessibility (spec 42): semantic, keyboard-reachable controls.
  const buttons = html.match(/<button\b[^>]*>/gi) ?? [];
  if (buttons.some((b) => !/\btype="button"/.test(b))) issues.push('Every <button> must declare type="button".');
  const flipCards = html.match(/<div class="flip-card"[^>]*>/g) ?? [];
  if (flipCards.some((c) => !c.includes('tabindex="0"') || !c.includes('role="button"') || !c.includes('aria-label="'))) {
    issues.push('Flip cards must be focusable buttons with an aria-label.');
  }
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) ?? [];
  if (tables.some((t) => !t.includes('<thead>') || !t.includes('<th scope="col"'))) issues.push('Tables need a <thead> with scoped column headers.');
  if (counts.table > 0 && !/<div class="table-wrap" role="region" aria-label="[^"]+"[^>]*tabindex="0"/.test(html)) {
    issues.push('Tables must sit in a labelled, focusable horizontal-scroll region for mobile.');
  }

  return { valid: issues.length === 0, issues };
}
