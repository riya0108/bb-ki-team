// Deterministic HTML assembly rather than trusting the model to produce valid,
// spec-conformant markup directly (spec 12.5: one H1, escaped content, no tracking
// scripts). The model only supplies content (headings/body text/widget copy); this
// module owns every structural, visual and scripting decision — including the single
// interactive <script> block below, whose source never changes and never interpolates
// model output (see htmlValidation.ts, which allowlists exactly this script's content).
//
// Visual design mirrors the Bull or Bear reference article format: a self-contained
// styled HTML document (kicker/title/deck, essay body, optional comparison-stat
// widget, optional flip-card "reveal" grid, optional two-option poll, optional pull
// quote, sources footer) rather than a bare <article> fragment.

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

// Splits on blank lines into paragraphs; each becomes its own <p>. Never trusts the
// model to have already wrapped its own <p> tags (spec 12.5: escape special
// characters correctly — the model's raw text is treated as plain text, not markup).
function paragraphsHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter((para) => para.length > 0)
    .map((para) => `<p>${escapeHtml(para)}</p>`)
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
  comparisonStat?: ComparisonStatWidget | null;
  revealCards?: RevealCardsWidget | null;
  poll?: PollWidget | null;
  pullQuote?: PullQuoteWidget | null;
}

export interface BuiltArticle {
  html: string;
  headingIds: string[];
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
// Both faces of every flip card, and both reveal panels of the poll, are already
// present in the DOM (pre-rendered by this builder with escaped model text); this
// script only toggles CSS classes, never writes innerHTML/textContent from data.
export const INTERACTIVE_SCRIPT = `document.querySelectorAll('.flip-card').forEach(function (card) {
  function flip() { card.classList.toggle('flipped'); }
  card.addEventListener('click', flip);
  card.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flip();
    }
  });
});

document.querySelectorAll('.poll-btn').forEach(function (button) {
  button.addEventListener('click', function () {
    var choice = button.getAttribute('data-choice');
    document.querySelectorAll('.poll-reveal').forEach(function (panel) {
      panel.classList.toggle('show', panel.getAttribute('data-choice') === choice);
    });
  });
});`;

function comparisonStatHtml(widget: ComparisonStatWidget): string {
  return `    <div class="gap-widget">
      <div class="gap-label">${escapeHtml(widget.label)}</div>
      <div class="gap-row">
        <div class="gap-col guess"><div class="gap-num">${escapeHtml(widget.leftValue)}</div><div class="gap-sub">${escapeHtml(widget.leftCaption)}</div></div>
        <div class="gap-arrow">&rarr;</div>
        <div class="gap-col real"><div class="gap-num">${escapeHtml(widget.rightValue)}</div><div class="gap-sub">${escapeHtml(widget.rightCaption)}</div></div>
      </div>
      <div class="gap-foot">${escapeHtml(widget.footnote)}</div>
    </div>`;
}

function revealCardsHtml(widget: RevealCardsWidget): string {
  const cardsHtml = widget.cards
    .map((card, i) => {
      const isLastAndOdd = i === widget.cards.length - 1 && widget.cards.length % 2 === 1;
      const centeredStyle = isLastAndOdd
        ? ' style="grid-column: 1 / -1; width: calc(50% - 7px); margin: 0 auto;"'
        : '';
      return `        <div class="flip-card" tabindex="0" role="button" aria-label="Reveal ${escapeHtml(widget.title)} ${i + 1}"${centeredStyle}>
          <div class="flip-inner">
            <div class="flip-face flip-front">
              <div class="num">#${i + 1}</div>
              <div class="icon">${escapeHtml(card.icon)}</div>
              <div class="teaser">${escapeHtml(card.teaser)}</div>
              <div class="tap-hint">tap to reveal</div>
            </div>
            <div class="flip-face flip-back">
              <div class="b-title">${escapeHtml(card.title)}</div>
              <div class="b-text">${escapeHtml(card.text)}</div>
            </div>
          </div>
        </div>`;
    })
    .join('\n');

  return `    <div class="reveal-wrap">
      <div class="reveal-title">${escapeHtml(widget.title)}</div>
      <div class="reveal-sub">Tap each card to reveal it</div>
      <div class="flip-grid">
${cardsHtml}
      </div>
    </div>`;
}

function pollHtml(widget: PollWidget): string {
  const buttonsHtml = widget.options
    .map((opt, i) => `        <button class="poll-btn" type="button" data-choice="opt-${i}">${escapeHtml(opt.label)}</button>`)
    .join('\n');
  const panelsHtml = widget.options
    .map((opt, i) => `      <div class="poll-reveal" data-choice="opt-${i}">${escapeHtml(opt.revealText)}</div>`)
    .join('\n');

  return `    <div class="poll">
      <p class="poll-q">${escapeHtml(widget.question)}</p>
      <div class="poll-actions">
${buttonsHtml}
      </div>
${panelsHtml}
    </div>`;
}

function pullQuoteHtml(widget: PullQuoteWidget): string {
  return `    <blockquote><p>${escapeHtml(widget.text)}</p></blockquote>`;
}

export function buildArticleHtml(input: BuildArticleHtmlInput): BuiltArticle {
  const headingIds = uniqueHeadingIds(input.sections.map((s) => s.heading));
  const sectionCount = input.sections.length;

  const widgetsAfter = new Map<number, string[]>();
  const scheduleWidget = (afterSectionIndex: number, html: string): void => {
    const index = clampSectionIndex(afterSectionIndex, sectionCount);
    const existing = widgetsAfter.get(index) ?? [];
    existing.push(html);
    widgetsAfter.set(index, existing);
  };
  if (input.comparisonStat) scheduleWidget(input.comparisonStat.afterSectionIndex, comparisonStatHtml(input.comparisonStat));
  if (input.revealCards) scheduleWidget(input.revealCards.afterSectionIndex, revealCardsHtml(input.revealCards));
  if (input.poll) scheduleWidget(input.poll.afterSectionIndex, pollHtml(input.poll));
  if (input.pullQuote) scheduleWidget(input.pullQuote.afterSectionIndex, pullQuoteHtml(input.pullQuote));

  const needsScript = Boolean(input.revealCards ?? input.poll);

  const sectionsHtml = input.sections
    .map((section, i) => {
      const sourceNoteHtml = section.sourceNote
        ? `\n      <p class="source-note"><em>${escapeHtml(section.sourceNote)}</em></p>`
        : '';
      const trailingWidgets = widgetsAfter.get(i);
      const widgetsHtml = trailingWidgets && trailingWidgets.length > 0 ? `\n${trailingWidgets.join('\n')}` : '';
      return `    <section id="${headingIds[i]}">
      <h2 class="section-head">${escapeHtml(section.heading)}</h2>
${paragraphsHtml(section.body)}${sourceNoteHtml}
    </section>${widgetsHtml}`;
    })
    .join('\n');

  const practicalHtml = input.practicalTakeaway
    ? `    <section id="what-to-do">
      <h2 class="section-head">What this means for you</h2>
${paragraphsHtml(input.practicalTakeaway)}
    </section>\n`
    : '';

  const disclaimerHtml = input.disclaimer
    ? `\n    <p class="disclaimer"><em>${escapeHtml(input.disclaimer)}</em></p>`
    : '';

  const sourcesHtml =
    input.sources.length > 0
      ? `\n    <p>${input.sources.map((s) => escapeHtml(s)).join(' &middot; ')}</p>`
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
${sectionsHtml}
${practicalHtml}    <section id="conclusion">
      <h2 class="section-head">Bottom line</h2>
${paragraphsHtml(input.conclusion)}
    </section>${disclaimerHtml}
  </main>
  <footer class="footer">${sourcesHtml}
  </footer>
</div>${scriptHtml}
</body>
</html>`;

  return { html, headingIds };
}

// Adapted from the Bull or Bear reference article template. Scoped to `.page` /
// `.essay` / the widget classes below so this file can be dropped into the site
// without leaking styles onto surrounding markup (spec 12.5).
const ARTICLE_CSS = `  :root{
    --paper:#FFFFFF;
    --ink:#181818;
    --ink-soft:#454545;
    --muted:#787878;
    --muted-light:#ABABA7;
    --border:#E9E8E5;
    --surface:#FAF9F7;
    --violet:#5D3FD3;
    --gold:#D6952E;
    --maxw:700px;
  }
  *{box-sizing:border-box;}
  html{background:#FFFFFF;}
  body{
    margin:0; background:#FFFFFF; color:var(--ink);
    font-family:'Figtree', system-ui, sans-serif;
    line-height:1.72; font-size:18px;
    -webkit-font-smoothing:antialiased;
  }
  .page{max-width:var(--maxw); margin:0 auto; padding:56px 24px 90px;}

  h1,h2{font-family:'Outfit', system-ui, sans-serif; font-weight:700; color:#0D0D0D; margin:0;}

  .kicker{
    font-family:'Fragment Mono', monospace; font-size:.72rem; font-weight:400;
    letter-spacing:.14em; text-transform:uppercase; color:var(--muted);
    margin-bottom:18px;
  }
  h1{font-size:clamp(1.85rem, 5vw, 2.5rem); line-height:1.18; letter-spacing:-.01em; margin-bottom:16px;}
  .dek{font-size:1.15rem; line-height:1.55; color:var(--ink-soft); margin:0 0 30px; max-width:56ch;}

  .essay p{margin:0 0 24px; color:var(--ink-soft); font-size:1.03rem;}
  .essay p:last-child{margin-bottom:0;}
  .essay strong{color:#0D0D0D; font-weight:700;}
  .essay em{color:#0D0D0D; font-style:italic;}
  .essay .source-note{font-size:.85rem; color:var(--muted);}
  .essay .disclaimer{font-size:.85rem; color:var(--muted);}

  h2.section-head{font-size:1.4rem; line-height:1.3; margin:46px 0 18px;}

  .gap-widget{background:var(--ink); border-radius:16px; padding:30px 26px; margin:30px 0; color:#F2F0EC;}
  .gap-label{font-family:'Fragment Mono', monospace; font-size:.68rem; letter-spacing:.1em; text-transform:uppercase; color:#A6A2C4; text-align:center; margin-bottom:20px;}
  .gap-row{display:flex; align-items:center; justify-content:center; gap:18px; flex-wrap:wrap;}
  .gap-col{text-align:center;}
  .gap-num{font-family:'Outfit', sans-serif; font-weight:800; font-size:2.1rem; line-height:1;}
  .gap-col.guess .gap-num{color:#B8B4D6;}
  .gap-col.real .gap-num{color:#fff;}
  .gap-sub{font-family:'Fragment Mono', monospace; font-size:.68rem; color:#8B87A8; margin-top:8px;}
  .gap-arrow{font-size:1.4rem; color:var(--gold); margin-top:-14px;}
  .gap-foot{text-align:center; font-size:.86rem; color:#C6C3DE; margin-top:18px; max-width:42ch; margin-left:auto; margin-right:auto;}

  blockquote{margin:36px 0; padding:2px 0 2px 24px; border-left:2.5px solid var(--violet);}
  blockquote p{font-style:italic; font-size:1.15rem; line-height:1.5; color:#151515; margin:0;}

  .reveal-wrap{margin:34px 0;}
  .reveal-title{font-family:'Outfit', sans-serif; font-weight:700; font-size:1.02rem; text-align:center; margin-bottom:4px;}
  .reveal-sub{font-family:'Fragment Mono', monospace; font-size:.7rem; color:var(--muted-light); text-align:center; margin-bottom:22px;}
  .flip-grid{display:grid; grid-template-columns:1fr 1fr; gap:14px;}
  .flip-card{perspective:1200px; height:168px; cursor:pointer;}
  .flip-inner{position:relative; width:100%; height:100%; transition:transform .55s cubic-bezier(.4,.2,.2,1); transform-style:preserve-3d;}
  .flip-card.flipped .flip-inner{transform:rotateY(180deg);}
  .flip-face{position:absolute; inset:0; backface-visibility:hidden; border-radius:12px; padding:16px 16px; display:flex; flex-direction:column;}
  .flip-front{background:var(--surface); border:1px solid var(--border); align-items:center; justify-content:center; text-align:center;}
  .flip-front .num{font-family:'Fragment Mono', monospace; font-size:.68rem; color:var(--violet); letter-spacing:.06em; text-transform:uppercase; margin-bottom:8px;}
  .flip-front .icon{font-size:1.7rem; margin-bottom:8px;}
  .flip-front .teaser{font-size:.84rem; color:var(--ink-soft); font-weight:600;}
  .flip-front .tap-hint{font-family:'Fragment Mono', monospace; font-size:.6rem; color:var(--muted-light); margin-top:10px;}
  .flip-back{background:var(--violet); color:#fff; transform:rotateY(180deg); justify-content:center; overflow-y:auto;}
  .flip-back .b-title{font-family:'Outfit', sans-serif; font-weight:700; font-size:.92rem; margin-bottom:6px; color:#fff;}
  .flip-back .b-text{font-size:.76rem; line-height:1.5; color:#E6E1FA;}

  .poll{background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:26px 26px 24px; margin:34px 0; text-align:center;}
  .poll-q{font-family:'Outfit', sans-serif; font-weight:700; font-size:1.05rem; color:#0D0D0D; margin-bottom:20px;}
  .poll-actions{display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-bottom:6px;}
  .poll-btn{
    font-family:'Outfit', sans-serif; font-weight:700; font-size:.86rem; color:var(--ink);
    background:#fff; border:1.5px solid var(--ink); border-radius:30px; padding:11px 20px; cursor:pointer;
  }
  .poll-btn:hover{background:var(--ink); color:#fff;}
  .poll-reveal{display:none; margin-top:18px; text-align:left; padding:16px 18px; background:#fff; border:1px solid var(--border); border-radius:10px; font-size:.92rem; color:var(--ink-soft); line-height:1.6;}
  .poll-reveal.show{display:block;}

  .footer{margin-top:54px; padding-top:22px; border-top:1px solid var(--border);}
  .footer p{font-family:'Figtree', sans-serif; font-size:.8rem; line-height:1.7; color:var(--muted); margin:0 0 8px;}

  @media (max-width:560px){
    body{font-size:16.5px;}
    .page{padding:38px 18px 70px;}
    .flip-grid{grid-template-columns:1fr;}
    .flip-card{height:150px;}
    .gap-num{font-size:1.7rem;}
  }`;
