// Deterministic HTML assembly rather than trusting the model to produce valid,
// spec-conformant markup directly (spec 12.5: one H1, escaped content, no tracking
// scripts). The model only supplies content (headings/body text/widget copy); this
// module owns every structural, visual and scripting decision — including the single
// interactive <script> block below, whose source never changes and never interpolates
// model output (see htmlValidation.ts, which allowlists exactly this script's content).
//
// Visual design mirrors the Bull or Bear reference article format: a self-contained
// styled HTML document (kicker/title/deck, optional "short version", essay body,
// optional table / comparison-stat / flip-card "reveal" grid / quiz / poll /
// choose-an-option decision / timeline / pull quote, sources footer) rather than a
// bare <article> fragment. Everything inside <main class="essay"> and the footer is
// what the publisher copies into the site's MDX (blogPostFragmentFromHtml), so every
// widget is self-contained there and no text can be read as an MDX expression.

import type { DecisionComponent, QuizComponent, TableComponent, TimelineComponent } from '@bb/shared-types';

import { ARTICLE_CSS } from './articleCss.js';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Body text additionally escapes braces: the published body is MDX, where a literal
// "{" in prose would be parsed as a JavaScript expression.
function esc(text: string): string {
  return escapeHtml(text).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

// Only absolute http(s) URLs and site-relative paths are ever emitted as links.
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed) || /^\/[^\s"'<>]*$/.test(trimmed)) return escapeHtml(trimmed);
  return null;
}

export interface InlineLink {
  anchorText: string;
  url: string;
}

// Splits on blank lines into paragraphs; each becomes its own <p>. Never trusts the
// model to have already wrapped its own <p> tags (spec 12.5: escape special
// characters correctly — the model's raw text is treated as plain text, not markup).
// Internal links (spec 35) are applied to the first occurrence of their anchor text,
// after escaping, so the link is the only markup that can ever enter a paragraph.
function paragraphsHtml(body: string, links: InlineLink[] = [], used = new Set<string>()): string {
  return body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .map((para) => {
      let html = esc(para);
      for (const link of links) {
        if (used.has(link.url)) continue;
        const href = safeHref(link.url);
        const anchor = esc(link.anchorText.trim());
        if (!href || anchor.length === 0) continue;
        const at = html.indexOf(anchor);
        if (at === -1) continue;
        html = `${html.slice(0, at)}<a href="${href}">${anchor}</a>${html.slice(at + anchor.length)}`;
        used.add(link.url);
      }
      return `<p>${html}</p>`;
    })
    .join('\n');
}

export interface HtmlSection {
  heading: string;
  body: string;
  sourceNote: string | null;
}

export interface ComparisonStatWidget {
  label: string;
  leftValue: string;
  leftCaption: string;
  rightValue: string;
  rightCaption: string;
  footnote: string;
  // 0-based index of the `sections` entry after which this widget is inserted;
  // clamped to a valid index by the builder.
  afterSectionIndex: number;
}

export interface RevealCard {
  icon: string;
  teaser: string;
  title: string;
  text: string;
  number?: string | null | undefined;
  sourceNote?: string | null | undefined;
}

export interface RevealCardsWidget {
  title: string;
  cards: RevealCard[];
  afterSectionIndex: number;
}

export interface PollOption {
  label: string;
  revealText: string;
}

export interface PollWidget {
  question: string;
  options: [PollOption, PollOption];
  afterSectionIndex: number;
}

export interface PullQuoteWidget {
  text: string;
  afterSectionIndex: number;
}

export interface SourceLink {
  label: string;
  url: string | null;
}

export interface BuildArticleHtmlInput {
  title: string;
  deck: string;
  category: string;
  metaDescription: string;
  sections: HtmlSection[];
  practicalTakeaway: string | null;
  conclusion: string;
  disclaimer: string | null;
  sources: string[];
  // Clean, labelled sources (spec 27). Supersedes `sources` when non-empty.
  sourceLinks?: SourceLink[] | null;
  shortVersion?: string[] | null;
  comparisonStat?: ComparisonStatWidget | null;
  revealCards?: RevealCardsWidget | null;
  poll?: PollWidget | null;
  pullQuote?: PullQuoteWidget | null;
  table?: TableComponent | null;
  quiz?: QuizComponent | null;
  decision?: DecisionComponent | null;
  timeline?: TimelineComponent | null;
  internalLinks?: InlineLink[] | null;
}

export interface BuiltArticle {
  html: string;
  headingIds: string[];
  // Which component types were actually rendered, in document order.
  components: string[];
}

// Disambiguates repeated heading text (e.g. two sections both titled "The catch")
// into distinct anchor IDs, since heading anchors must be unique per spec 12.5.
function uniqueHeadingIds(headings: string[]): string[] {
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const base = slugify(heading) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

function clampSectionIndex(index: number, sectionCount: number): number {
  if (sectionCount === 0) return 0;
  return Math.min(Math.max(index, 0), sectionCount - 1);
}

// The one and only <script> this builder ever emits. Its source is fixed — it never
// interpolates model-supplied text — so htmlValidation.ts can allowlist it exactly.
// Every face/panel/answer is already present in the DOM (pre-rendered by this builder
// with escaped model text); this script only toggles classes and attributes. The one
// thing it ever writes is the quiz score, built from counts, never from content.
// Every control is a native <button> (Enter/Space for free) except flip cards, which
// carry role="button" + tabindex and handle Enter/Space themselves.
export const INTERACTIVE_SCRIPT = `(function () {
  function each(selector, root, fn) {
    Array.prototype.forEach.call((root || document).querySelectorAll(selector), fn);
  }

  each('.flip-card', null, function (card) {
    function flip() {
      var flipped = card.classList.toggle('flipped');
      card.setAttribute('aria-pressed', flipped ? 'true' : 'false');
    }
    card.addEventListener('click', flip);
    card.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flip();
      }
    });
  });

  each('.poll', null, function (poll) {
    each('.poll-btn', poll, function (button) {
      button.addEventListener('click', function () {
        var choice = button.getAttribute('data-choice');
        each('.poll-btn', poll, function (b) { b.setAttribute('aria-pressed', b === button ? 'true' : 'false'); });
        each('.poll-reveal', poll, function (panel) {
          panel.classList.toggle('show', panel.getAttribute('data-choice') === choice);
        });
      });
    });
  });

  each('.decision', null, function (widget) {
    each('.decision-btn', widget, function (button) {
      button.addEventListener('click', function () {
        var choice = button.getAttribute('data-choice');
        each('.decision-btn', widget, function (b) { b.setAttribute('aria-pressed', b === button ? 'true' : 'false'); });
        each('.decision-reveal', widget, function (panel) {
          if (panel.getAttribute('data-choice') === choice) {
            panel.removeAttribute('hidden');
          } else {
            panel.setAttribute('hidden', '');
          }
        });
      });
    });
  });

  each('.quiz', null, function (quiz) {
    var total = quiz.querySelectorAll('.quiz-q').length;
    var answered = 0;
    var correct = 0;
    each('.quiz-q', quiz, function (question) {
      each('.quiz-opt', question, function (option) {
        option.addEventListener('click', function () {
          if (question.getAttribute('data-answered') === 'true') { return; }
          question.setAttribute('data-answered', 'true');
          var isCorrect = option.getAttribute('data-correct') === 'true';
          answered += 1;
          if (isCorrect) { correct += 1; }
          option.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
          option.setAttribute('aria-pressed', 'true');
          each('.quiz-opt', question, function (o) {
            if (o.getAttribute('data-correct') === 'true') { o.classList.add('is-answer'); }
            o.setAttribute('aria-disabled', 'true');
          });
          each('.quiz-result', question, function (panel) {
            if (panel.getAttribute('data-result') === (isCorrect ? 'correct' : 'incorrect')) {
              panel.removeAttribute('hidden');
            }
          });
          if (answered === total) {
            var score = quiz.querySelector('.quiz-score');
            if (score) {
              score.textContent = 'You got ' + correct + ' of ' + total + '.';
              score.removeAttribute('hidden');
            }
          }
        });
      });
    });
  });
})();`;

function comparisonStatHtml(widget: ComparisonStatWidget): string {
  return `    <div class="gap-widget">
      <div class="gap-label">${esc(widget.label)}</div>
      <div class="gap-row">
        <div class="gap-col guess"><div class="gap-num">${esc(widget.leftValue)}</div><div class="gap-sub">${esc(widget.leftCaption)}</div></div>
        <div class="gap-arrow" aria-hidden="true">&rarr;</div>
        <div class="gap-col real"><div class="gap-num">${esc(widget.rightValue)}</div><div class="gap-sub">${esc(widget.rightCaption)}</div></div>
      </div>
      <div class="gap-foot">${esc(widget.footnote)}</div>
    </div>`;
}

function revealCardsHtml(widget: RevealCardsWidget): string {
  const cardsHtml = widget.cards
    .map((card, i) => {
      const isLastAndOdd = i === widget.cards.length - 1 && widget.cards.length % 2 === 1;
      const centeredStyle = isLastAndOdd
        ? ' style="grid-column: 1 / -1; width: calc(50% - 7px); margin: 0 auto;"'
        : '';
      const number = card.number ? `\n              <div class="big-num">${esc(card.number)}</div>` : '';
      const source = card.sourceNote ? `\n              <div class="b-source">${esc(card.sourceNote)}</div>` : '';
      return `        <div class="flip-card" tabindex="0" role="button" aria-pressed="false" aria-label="Reveal card ${i + 1}: ${esc(card.teaser)}"${centeredStyle}>
          <div class="flip-inner">
            <div class="flip-face flip-front">
              <div class="num">#${i + 1}</div>
              <div class="icon" aria-hidden="true">${esc(card.icon)}</div>${number}
              <div class="teaser">${esc(card.teaser)}</div>
              <div class="tap-hint" aria-hidden="true">tap to reveal</div>
            </div>
            <div class="flip-face flip-back">
              <div class="b-title">${esc(card.title)}</div>
              <div class="b-text">${esc(card.text)}</div>${source}
            </div>
          </div>
        </div>`;
    })
    .join('\n');

  return `    <div class="reveal-wrap">
      <div class="reveal-title">${esc(widget.title)}</div>
      <div class="reveal-sub">Tap each card to reveal it</div>
      <div class="flip-grid">
${cardsHtml}
      </div>
    </div>`;
}

function pollHtml(widget: PollWidget): string {
  const buttonsHtml = widget.options
    .map((opt, i) => `        <button class="poll-btn" type="button" data-choice="opt-${i}" aria-pressed="false">${esc(opt.label)}</button>`)
    .join('\n');
  const panelsHtml = widget.options
    .map((opt, i) => `        <div class="poll-reveal" data-choice="opt-${i}">${esc(opt.revealText)}</div>`)
    .join('\n');

  return `    <div class="poll">
      <p class="poll-q" id="bb-poll-q">${esc(widget.question)}</p>
      <div class="poll-actions" role="group" aria-labelledby="bb-poll-q">
${buttonsHtml}
      </div>
      <div aria-live="polite">
${panelsHtml}
      </div>
    </div>`;
}

function pullQuoteHtml(widget: PullQuoteWidget): string {
  return `    <blockquote><p>${esc(widget.text)}</p></blockquote>`;
}

// Right-align a column when the model asked for it or when every body cell in it
// reads as a figure.
function isNumericColumn(table: TableComponent, column: number): boolean {
  const declared = table.columns[column]?.align === 'right';
  const cells = table.rows.map((r) => r[column] ?? '').filter((c) => c.length > 0);
  return declared || (cells.length > 0 && cells.every((c) => /^[~≈<>]?[₹$€£]?\s?[\d.,]+\s?(%|bps|pp|x|cr|crore|lakh|bn|mn|k)?$/i.test(c.trim())));
}

function tableHtml(table: TableComponent): string {
  const numeric = table.columns.map((_, i) => i > 0 && isNumericColumn(table, i));
  const head = table.columns
    .map((c, i) => `<th scope="col"${numeric[i] ? ' class="num"' : ''}>${esc(c.label)}</th>`)
    .join('');
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => (i === 0 ? `<th scope="row">${esc(cell)}</th>` : `<td${numeric[i] ? ' class="num"' : ''}>${esc(cell)}</td>`))
          .join('')}</tr>`,
    )
    .join('');
  const subtitle = table.subtitle ? `<span class="table-sub">${esc(table.subtitle)}</span>` : '';
  const footnote = table.footnote ? `\n      <div class="table-foot">${esc(table.footnote)}</div>` : '';
  return `    <figure class="table-figure">
      <figcaption><span class="widget-title">${esc(table.title)}</span>${subtitle}</figcaption>
      <div class="table-wrap" role="region" aria-label="${esc(table.title)} (scrolls horizontally)" tabindex="0">
        <table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      </div>
      <div class="table-source">${esc(table.sourceNote)}</div>${footnote}
    </figure>`;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

function quizHtml(quiz: QuizComponent): string {
  const questions = quiz.questions
    .map((q, qi) => {
      const id = `bb-quiz-q-${qi + 1}`;
      const options = q.options
        .map(
          (opt, oi) =>
            `          <button type="button" class="quiz-opt" data-correct="${oi === q.correctOptionIndex ? 'true' : 'false'}" aria-pressed="false">${OPTION_LETTERS[oi] ?? ''}. ${esc(opt)}</button>`,
        )
        .join('\n');
      const answer = q.options[q.correctOptionIndex] ?? '';
      const source = q.sourceNote ? `<span class="quiz-source">${esc(q.sourceNote)}</span>` : '';
      return `      <div class="quiz-q">
        <p class="quiz-question" id="${id}">${qi + 1}. ${esc(q.question)}</p>
        <div class="quiz-options" role="group" aria-labelledby="${id}">
${options}
        </div>
        <div class="quiz-feedback" aria-live="polite">
          <div class="quiz-result" data-result="correct" hidden><strong>Correct.</strong> ${esc(q.explanation)}${source}</div>
          <div class="quiz-result" data-result="incorrect" hidden><strong>Not quite. The answer is ${OPTION_LETTERS[q.correctOptionIndex] ?? ''}: ${esc(answer)}.</strong> ${esc(q.explanation)}${source}</div>
        </div>
      </div>`;
    })
    .join('\n');
  const count = quiz.questions.length;
  return `    <div class="quiz">
      <div class="widget-title">${esc(quiz.title)}</div>
      <div class="widget-sub">Test yourself: ${count} question${count === 1 ? '' : 's'}</div>
${questions}
      <div class="quiz-score" aria-live="polite" hidden></div>
    </div>`;
}

function decisionHtml(decision: DecisionComponent): string {
  const buttons = decision.options
    .map((o, i) => `        <button type="button" class="decision-btn" data-choice="opt-${i}" aria-pressed="false">${esc(o.label)}</button>`)
    .join('\n');
  const reveals = decision.options
    .map((o, i) => {
      const evidence = o.evidenceNote ? `<div class="dr-evidence">${esc(o.evidenceNote)}</div>` : '';
      return `        <div class="decision-reveal" data-choice="opt-${i}" hidden><div class="dr-title">${esc(o.revealTitle)}</div><div class="dr-text">${esc(o.revealText)}</div>${evidence}</div>`;
    })
    .join('\n');
  return `    <div class="decision">
      <div class="widget-title">${esc(decision.title)}</div>
      <p class="decision-q" id="bb-decision-q">${esc(decision.question)}</p>
      <div class="decision-actions" role="group" aria-labelledby="bb-decision-q">
${buttons}
      </div>
      <div class="decision-reveals" aria-live="polite">
${reveals}
      </div>
    </div>`;
}

function timelineHtml(timeline: TimelineComponent): string {
  const events = timeline.events
    .map((e) => {
      const source = e.sourceNote ? `<div class="tl-source">${esc(e.sourceNote)}</div>` : '';
      return `        <li><div class="tl-date">${esc(e.date)}</div><div class="tl-title">${esc(e.title)}</div><div class="tl-text">${esc(e.description)}</div>${source}</li>`;
    })
    .join('\n');
  return `    <div class="timeline-wrap">
      <div class="widget-title">${esc(timeline.title)}</div>
      <ol class="timeline">
${events}
      </ol>
    </div>`;
}

function shortVersionHtml(points: string[]): string {
  return `    <aside class="short-version" aria-label="The short version">
      <div class="sv-label">The short version</div>
      <ul>
${points.map((p) => `        <li>${esc(p)}</li>`).join('\n')}
      </ul>
    </aside>\n`;
}

function sourceLabelFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sourcesFooterHtml(input: BuildArticleHtmlInput): string {
  const links: SourceLink[] =
    input.sourceLinks && input.sourceLinks.length > 0
      ? input.sourceLinks
      : input.sources.map((s) => (/^https?:\/\//i.test(s.trim()) ? { label: sourceLabelFromUrl(s.trim()), url: s.trim() } : { label: s, url: null }));
  if (links.length === 0) return '';
  const items = links
    .map((l) => {
      const href = l.url ? safeHref(l.url) : null;
      return href
        ? `      <li><a href="${href}" rel="nofollow noopener noreferrer" target="_blank">${esc(l.label)}</a></li>`
        : `      <li>${esc(l.label)}</li>`;
    })
    .join('\n');
  return `\n    <div class="sources-title">Sources</div>\n    <ol class="sources-list">\n${items}\n    </ol>`;
}

export function buildArticleHtml(input: BuildArticleHtmlInput): BuiltArticle {
  const headingIds = uniqueHeadingIds(input.sections.map((s) => s.heading));
  const sectionCount = input.sections.length;

  const widgetsAfter = new Map<number, { type: string; html: string }[]>();
  const scheduleWidget = (type: string, afterSectionIndex: number, html: string): void => {
    const index = clampSectionIndex(afterSectionIndex, sectionCount);
    const existing = widgetsAfter.get(index) ?? [];
    existing.push({ type, html });
    widgetsAfter.set(index, existing);
  };
  if (input.table) scheduleWidget('table', input.table.afterSectionIndex, tableHtml(input.table));
  if (input.comparisonStat) scheduleWidget('comparisonStat', input.comparisonStat.afterSectionIndex, comparisonStatHtml(input.comparisonStat));
  if (input.timeline) scheduleWidget('timeline', input.timeline.afterSectionIndex, timelineHtml(input.timeline));
  if (input.revealCards) scheduleWidget('revealCards', input.revealCards.afterSectionIndex, revealCardsHtml(input.revealCards));
  if (input.decision) scheduleWidget('decision', input.decision.afterSectionIndex, decisionHtml(input.decision));
  if (input.quiz) scheduleWidget('quiz', input.quiz.afterSectionIndex, quizHtml(input.quiz));
  if (input.poll) scheduleWidget('poll', input.poll.afterSectionIndex, pollHtml(input.poll));
  if (input.pullQuote) scheduleWidget('pullQuote', input.pullQuote.afterSectionIndex, pullQuoteHtml(input.pullQuote));

  const needsScript = Boolean(input.revealCards ?? input.poll ?? input.quiz ?? input.decision);
  const links = input.internalLinks ?? [];
  const usedLinks = new Set<string>();
  const components: string[] = [];

  const sectionsHtml = input.sections
    .map((section, i) => {
      const sourceNoteHtml = section.sourceNote
        ? `\n      <p class="source-note"><em>${esc(section.sourceNote)}</em></p>`
        : '';
      const trailingWidgets = widgetsAfter.get(i) ?? [];
      components.push(...trailingWidgets.map((w) => w.type));
      const widgetsHtml = trailingWidgets.length > 0 ? `\n${trailingWidgets.map((w) => w.html).join('\n')}` : '';
      return `    <section id="${headingIds[i]}">
      <h2 class="section-head">${esc(section.heading)}</h2>
${paragraphsHtml(section.body, links, usedLinks)}${sourceNoteHtml}
    </section>${widgetsHtml}`;
    })
    .join('\n');

  const shortVersion = input.shortVersion && input.shortVersion.length > 0 ? shortVersionHtml(input.shortVersion) : '';

  const practicalHtml = input.practicalTakeaway
    ? `    <section id="what-to-do">
      <h2 class="section-head">What this means for you</h2>
${paragraphsHtml(input.practicalTakeaway, links, usedLinks)}
    </section>\n`
    : '';

  const disclaimerHtml = input.disclaimer
    ? `\n    <p class="disclaimer"><em>${esc(input.disclaimer)}</em></p>`
    : '';

  const scriptHtml = needsScript ? `\n<script>\n${INTERACTIVE_SCRIPT}\n</script>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(input.title)}</title>
<meta name="description" content="${escapeHtml(input.metaDescription)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Figtree:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Fragment+Mono&display=swap" rel="stylesheet">
<style>
${ARTICLE_CSS}
</style>
</head>
<body>
<div class="page">
  <header>
    <div class="kicker">${escapeHtml(input.category)}</div>
    <h1>${escapeHtml(input.title)}</h1>
    <p class="dek">${escapeHtml(input.deck)}</p>
  </header>
  <main class="essay">
${shortVersion}${sectionsHtml}
${practicalHtml}    <section id="conclusion">
      <h2 class="section-head">Bottom line</h2>
${paragraphsHtml(input.conclusion, links, usedLinks)}
    </section>${disclaimerHtml}
  </main>
  <footer class="footer">${sourcesFooterHtml(input)}
  </footer>
</div>${scriptHtml}
</body>
</html>`;

  return { html, headingIds, components };
}
