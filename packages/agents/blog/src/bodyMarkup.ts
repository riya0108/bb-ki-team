// The small, closed markup language a section body may use. The writer model never
// emits HTML: it writes plain text with these few conventions, and this module turns
// them into escaped, deterministic markup (htmlBuilder.ts) or strips them back to
// plain prose for QA, word counts and the slop/critic checks (articleText.ts).
//
//   blank line          new block
//   ### Heading         an H3 subsection heading (block's first line)
//   - item / * item     a bulleted list (every line of the block)
//   > sentence          a pull quote: one sentence lifted from the article itself
//   **bold**, *italic*  inline emphasis
//   [anchor](claim_7)   an inline citation: links the anchor to the source that
//                       verifiably backs claim_7. Only claim IDs, never URLs — the
//                       builder resolves them, so a model can't invent a link.

export type BodyBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'pull'; text: string };

const LIST_LINE = /^\s*[-*•]\s+/;
const H3_LINE = /^\s*#{2,4}\s+/;
const PULL_LINE = /^\s*>\s?/;

export function parseBody(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    const first = lines[0] ?? '';

    if (H3_LINE.test(first)) {
      blocks.push({ kind: 'h3', text: first.replace(H3_LINE, '').replace(/\*\*/g, '').trim() });
      const rest = lines.slice(1);
      if (rest.length > 0) blocks.push(...parseBody(rest.join('\n')));
      continue;
    }
    if (lines.every((l) => LIST_LINE.test(l))) {
      blocks.push({ kind: 'ul', items: lines.map((l) => l.replace(LIST_LINE, '').trim()) });
      continue;
    }
    if (lines.every((l) => PULL_LINE.test(l))) {
      blocks.push({ kind: 'pull', text: lines.map((l) => l.replace(PULL_LINE, '').trim()).join(' ') });
      continue;
    }
    // A paragraph followed directly by list lines (no blank line between them).
    const listStart = lines.findIndex((l) => LIST_LINE.test(l));
    if (listStart > 0 && lines.slice(listStart).every((l) => LIST_LINE.test(l))) {
      blocks.push({ kind: 'p', text: lines.slice(0, listStart).join(' ').trim() });
      blocks.push({ kind: 'ul', items: lines.slice(listStart).map((l) => l.replace(LIST_LINE, '').trim()) });
      continue;
    }
    blocks.push({ kind: 'p', text: lines.map((l) => l.trim()).join(' ') });
  }
  return blocks;
}

const CITATION = /\[([^\]\n]+)\]\(([A-Za-z0-9_.:-]+)\)/g;

// Inline markup -> plain words.
export function inlinePlain(text: string): string {
  return text
    .replace(CITATION, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1$2');
}

// A body's readable text: one paragraph per block, markup removed. Pull quotes repeat
// a sentence already in the article, so they are left out of the prose.
export function bodyPlainText(body: string): string {
  return parseBody(body)
    .flatMap((b) => {
      if (b.kind === 'ul') return b.items.map(inlinePlain);
      if (b.kind === 'pull') return [];
      return [inlinePlain(b.text)];
    })
    .join('\n\n');
}

export function bodySubheadings(body: string): string[] {
  return parseBody(body)
    .filter((b): b is { kind: 'h3'; text: string } => b.kind === 'h3')
    .map((b) => b.text);
}

export function bodyPullQuotes(body: string): string[] {
  return parseBody(body)
    .filter((b): b is { kind: 'pull'; text: string } => b.kind === 'pull')
    .map((b) => inlinePlain(b.text));
}

// Claim IDs cited inline, in order of first use.
export function bodyCitedClaimIds(body: string): string[] {
  return [...new Set([...body.matchAll(CITATION)].map((m) => m[2] ?? '').filter((id) => id.length > 0))];
}

export interface InlineRenderOptions {
  // Already-escaped text in, markup out. `escape` is applied to every model-supplied
  // fragment before any tag is added.
  escape: (text: string) => string;
  // claim ID -> safe href (already validated/escaped), or absent.
  citationHref: (claimId: string) => string | null;
}

// Escape first, then add only the tags this module owns. Brackets, parentheses and
// asterisks survive HTML escaping unchanged, so the patterns still match afterwards.
export function renderInline(text: string, options: InlineRenderOptions): string {
  return options
    .escape(text)
    .replace(CITATION, (_m, anchor: string, id: string) => {
      const href = options.citationHref(id);
      return href ? `<a href="${href}" rel="noopener" target="_blank">${anchor}</a>` : anchor;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>');
}
