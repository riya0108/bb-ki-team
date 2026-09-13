// Deterministic HTML assembly rather than trusting the model to produce valid,
// spec-conformant markup directly (spec 12.5: one H1, generated TOC anchor IDs,
// semantic tags). The model only supplies content (headings/body text); this module
// owns every structural decision.

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

export interface BuildArticleHtmlInput {
  title: string;
  deck: string;
  category: string;
  sections: HtmlSection[];
  practicalTakeaway: string | null;
  conclusion: string;
  disclaimer: string | null;
  sources: string[];
}

export interface BuiltArticle {
  html: string;
  headingIds: string[];
}

// Disambiguates repeated heading text (e.g. two sections both titled "The catch")
// into distinct anchor IDs, since TOC anchors must be unique per spec 12.5.
function uniqueHeadingIds(headings: string[]): string[] {
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const base = slugify(heading) || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

export function buildArticleHtml(input: BuildArticleHtmlInput): BuiltArticle {
  const headingIds = uniqueHeadingIds(input.sections.map((s) => s.heading));

  const tocItems = input.sections
    .map((section, i) => `      <li><a href="#${headingIds[i]}">${escapeHtml(section.heading)}</a></li>`)
    .join('\n');

  const sectionsHtml = input.sections
    .map((section, i) => {
      const sourceNoteHtml = section.sourceNote
        ? `\n      <p class="source-note"><em>${escapeHtml(section.sourceNote)}</em></p>`
        : '';
      return `    <section id="${headingIds[i]}">
      <h2>${escapeHtml(section.heading)}</h2>
${paragraphsHtml(section.body)}${sourceNoteHtml}
    </section>`;
    })
    .join('\n');

  const practicalHtml = input.practicalTakeaway
    ? `    <section id="what-to-do">
      <h2>What this means for you</h2>
${paragraphsHtml(input.practicalTakeaway)}
    </section>\n`
    : '';

  const disclaimerHtml = input.disclaimer
    ? `\n    <p class="disclaimer"><em>${escapeHtml(input.disclaimer)}</em></p>`
    : '';

  const sourcesHtml =
    input.sources.length > 0
      ? `\n    <section id="sources">
      <h2>Sources</h2>
      <ul>
${input.sources.map((s) => `        <li>${escapeHtml(s)}</li>`).join('\n')}
      </ul>
    </section>`
      : '';

  const html = `<article class="bb-article" data-category="${escapeHtml(input.category)}">
  <header>
    <h1>${escapeHtml(input.title)}</h1>
    <p class="deck">${escapeHtml(input.deck)}</p>
  </header>
  <nav class="toc" aria-label="Table of contents">
    <ul>
${tocItems}
    </ul>
  </nav>
  <main>
${sectionsHtml}
${practicalHtml}    <section id="conclusion">
      <h2>Bottom line</h2>
${paragraphsHtml(input.conclusion)}
    </section>${disclaimerHtml}
  </main>
  <footer>${sourcesHtml}
  </footer>
</article>`;

  return { html, headingIds };
}
