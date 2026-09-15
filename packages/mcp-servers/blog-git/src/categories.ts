import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The site's own taxonomy (src/content/categories.json in the target repo) is the
// only source of truth for valid category slugs — read fresh on every publish
// rather than hardcoded here, so a category added/renamed on the site side is
// picked up without touching this connector.
interface SiteCategory {
  slug: string;
}

export async function loadCategorySlugs(repoPath: string): Promise<string[]> {
  const raw = await readFile(path.join(repoPath, 'src/content/categories.json'), 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('src/content/categories.json did not parse to an array');
  }
  return parsed.map((entry) => (entry as SiteCategory).slug);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Our Blog Agent picks a freeform editorial category ("Safety & Standards", "BRICS
// 2026 economics") — the site restricts posts to a fixed, small taxonomy. Rather
// than fail every real article whose category isn't already one of the site's
// slugs, map by keyword and fall back to a sensible default; this is a navigation
// bucket, not a factual claim, so a best-effort choice here doesn't risk
// fabricating anything (CLAUDE.md's fabrication rule is about facts/sources, not
// taxonomy). Callers get back whether the match was exact so it can be logged.
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
