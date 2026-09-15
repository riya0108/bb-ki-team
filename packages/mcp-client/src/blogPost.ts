// Converts an approved blog ContentItem's currentText — the self-contained HTML
// document packages/agents/blog's htmlBuilder.ts assembled and a human approved —
// into the fragment the blog-git MCP server needs to write an MDX post.
//
// Deliberately parses currentText (the exact approved version) rather than
// regenerating from the item's `package` column: a manual dashboard edit updates
// currentText but not package (see apps/api/src/routes/content.ts's revisions
// route), so package can be stale relative to what was actually approved.
// Approval attaches to an exact content version (CLAUDE.md) — only currentText is
// guaranteed to still be that version.

export class BlogHtmlParseError extends Error {
  constructor(missing: string) {
    super(`Could not extract "${missing}" from the approved blog article HTML — htmlBuilder.ts's template may have changed.`);
    this.name = 'BlogHtmlParseError';
  }
}

export interface BlogPostFragment {
  title: string;
  metaDescription: string;
  categoryRaw: string;
  bodyMdx: string;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
};

function unescapeHtml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_match, entity: string) => HTML_ENTITIES[entity] ?? _match);
}

function extract(html: string, pattern: RegExp, label: string): string {
  const match = html.match(pattern);
  const captured = match?.[1];
  if (captured === undefined) throw new BlogHtmlParseError(label);
  return captured;
}

// htmlBuilder.ts's CSS is written for a document that owns <html>/<body> outright —
// it includes bare `body{...}`, `html{...}` and `h1,h2{...}` rules alongside its
// `.page`/`.essay`/widget-scoped ones. A <style> tag applies document-wide
// regardless of where it sits in the DOM, so embedded as-is those bare-element
// rules would override the site's own global background/typography (and dark
// mode) on every element of the page, not just this article's content. Strip any
// top-level rule (or @media sub-rule) whose selector list is made up entirely of
// bare element/universal selectors — :root and every class-scoped rule (including
// `h2.section-head`) survive untouched.
const BARE_SELECTOR_BLOCKLIST = new Set(['*', 'html', 'body', 'h1', 'h2']);

function isBareSelectorRule(selector: string): boolean {
  const parts = selector.split(',').map((part) => part.trim());
  return parts.every((part) => BARE_SELECTOR_BLOCKLIST.has(part));
}

// Splits `css` into top-level statements (a plain rule, or an @-block containing
// nested rules), respecting brace nesting. Sufficient for htmlBuilder.ts's CSS,
// which has no braces inside strings/comments to confuse a naive scan.
function splitTopLevelStatements(css: string): string[] {
  const statements: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        statements.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  return statements;
}

function stripGlobalElementRules(css: string): string {
  return splitTopLevelStatements(css)
    .map((statement) => {
      const trimmed = statement.trim();
      if (trimmed.startsWith('@')) {
        const braceIndex = trimmed.indexOf('{');
        const header = trimmed.slice(0, braceIndex);
        const inner = trimmed.slice(braceIndex + 1, -1);
        const filteredInner = splitTopLevelStatements(inner)
          .filter((rule) => {
            const selector = rule.slice(0, rule.indexOf('{')).trim();
            return !isBareSelectorRule(selector);
          })
          .join('\n');
        return filteredInner ? `${header}{\n${filteredInner}\n}` : '';
      }
      const selector = trimmed.slice(0, trimmed.indexOf('{')).trim();
      return isBareSelectorRule(selector) ? '' : trimmed;
    })
    .filter((statement) => statement.length > 0)
    .join('\n');
}

// MDX parses `<style>`/`<script>` tag content as JSX children, not as HTML5's raw
// text elements — a literal `{` inside (which CSS/JS always have) is read as the
// start of a JS expression container and breaks the compile ("Expected a closing
// tag for `<style>`" from @astrojs/mdx). Wrapping the content as a JS template
// literal expression (`<style>{\`...\`}</style>`) sidesteps this: MDX only needs to
// parse it as valid JS, and the template literal's own text is untouched at
// runtime, so it renders identically to a literal <style>/<script> block.
function asJsTemplateLiteralExpression(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return `{\`${escaped}\`}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function blogPostFragmentFromHtml(html: string): BlogPostFragment {
  const title = unescapeHtml(extract(html, /<title>([\s\S]*?)<\/title>/, 'title'));
  const metaDescription = unescapeHtml(
    extract(html, /<meta name="description" content="([\s\S]*?)">/, 'meta description'),
  );
  const categoryRaw = unescapeHtml(extract(html, /<div class="kicker">([\s\S]*?)<\/div>/, 'category kicker'));
  const style = stripGlobalElementRules(extract(html, /<style>([\s\S]*?)<\/style>/, 'style block'));
  const main = extract(html, /<main class="essay">([\s\S]*?)<\/main>/, 'article body');
  const footer = extract(html, /<footer class="footer">([\s\S]*?)<\/footer>/, 'sources footer');
  const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);

  const parts = [
    `<style>${asJsTemplateLiteralExpression(style)}</style>`,
    main.trim(),
    `<footer class="footer">${footer}</footer>`,
  ];
  if (scriptMatch?.[1]) {
    parts.push(`<script>${asJsTemplateLiteralExpression(scriptMatch[1])}</script>`);
  }

  return { title, metaDescription, categoryRaw, bodyMdx: parts.join('\n\n') };
}
