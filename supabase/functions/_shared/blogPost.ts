// Deno port of packages/mcp-client/src/blogPost.ts + packages/mcp-servers/blog-git/src/{mdxFile,categories}.ts —
// pure string logic, no Node-specific APIs, so this is a straight copy. Kept as a
// separate file (not re-exported from the Node packages) because Edge Functions
// bundle each function's dependency tree independently and can't `import` across the
// npm workspace boundary; see supabase/functions/README.md for why this exists.

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

const BARE_SELECTOR_BLOCKLIST = new Set(['*', 'html', 'body', 'h1', 'h2']);

function isBareSelectorRule(selector: string): boolean {
  const parts = selector.split(',').map((part) => part.trim());
  return parts.every((part) => BARE_SELECTOR_BLOCKLIST.has(part));
}

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

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function yamlStringArray(values: string[]): string {
  return `[${values.map(yamlString).join(', ')}]`;
}

export interface BlogFrontmatter {
  title: string;
  description: string;
  categorySlug: string;
  tags: string[];
  pubDateIso: string;
  authorName: string;
  authorBio: string;
  // Mirrors packages/mcp-servers/blog-git/src/mdxFile.ts's BlogFrontmatter — only
  // ever populated from the content's latest visual_assets row when its status is
  // APPROVED (see fire-due-schedules/index.ts). Null/omitted means
  // the site's Thumbnail.astro falls back to its generated placeholder graphic.
  heroImageUrl?: string | null;
  heroImageAlt?: string | null;
}

export function buildMdxFileContents(frontmatter: BlogFrontmatter, bodyMdx: string): string {
  const pubDate = frontmatter.pubDateIso.slice(0, 10);
  const frontmatterLines = [
    '---',
    `title: ${yamlString(frontmatter.title)}`,
    `description: ${yamlString(frontmatter.description)}`,
    `category: ${frontmatter.categorySlug}`,
    `tags: ${yamlStringArray(frontmatter.tags)}`,
    `pubDate: ${pubDate}`,
    `author: { name: ${yamlString(frontmatter.authorName)}, bio: ${yamlString(frontmatter.authorBio)} }`,
    ...(frontmatter.heroImageUrl ? [`heroImage: ${yamlString(frontmatter.heroImageUrl)}`] : []),
    ...(frontmatter.heroImageUrl && frontmatter.heroImageAlt
      ? [`heroImageAlt: ${yamlString(frontmatter.heroImageAlt)}`]
      : []),
    'draft: false',
    '---',
  ];
  return `${frontmatterLines.join('\n')}\n\n${bodyMdx.trim()}\n`;
}

interface SiteCategory {
  slug: string;
}

export function parseCategorySlugs(json: string): string[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('categories.json did not parse to an array');
  }
  return parsed.map((entry) => (entry as SiteCategory).slug);
}

const KEYWORD_TO_SLUG: readonly (readonly [RegExp, string])[] = [
  [/\bai\b|artificial.intelligence|machine.learning/, 'ai'],
  [/tech|gadget|software|app\b/, 'tech'],
  [/personal.finance|budget|saving|salary|credit.card|emi\b/, 'personal-finance'],
  [/money|market|invest|trading|stock|mutual.fund|gold|crypto/, 'money'],
  [/finance|bank|corporate/, 'finance'],
  [/politic|policy|election|government|parliament/, 'politics'],
  [/world|geopolit|war|global/, 'world'],
  [/lifestyle|culture|mindset|wellbeing|health/, 'lifestyle'],
  [/business|company|startup|deal/, 'business'],
];
const DEFAULT_SLUG = 'business';

export interface CategoryResolution {
  slug: string;
  exactMatch: boolean;
}

export function resolveCategorySlug(rawCategory: string, validSlugs: string[]): CategoryResolution {
  const normalized = slugify(rawCategory);
  if (validSlugs.includes(normalized)) {
    return { slug: normalized, exactMatch: true };
  }

  const lowered = rawCategory.toLowerCase();
  for (const [pattern, slug] of KEYWORD_TO_SLUG) {
    if (pattern.test(lowered) && validSlugs.includes(slug)) {
      return { slug, exactMatch: false };
    }
  }

  return { slug: validSlugs.includes(DEFAULT_SLUG) ? DEFAULT_SLUG : (validSlugs[0] ?? DEFAULT_SLUG), exactMatch: false };
}
