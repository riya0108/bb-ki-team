// YAML double-quoted scalar escaping — only backslash and double-quote need
// escaping for a single-line quoted string (spec: matches every hand-authored post
// already in src/content/posts/*.mdx, which all use double-quoted frontmatter
// strings).
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
  // The BB Visual Agent's stored master asset URL for this exact approved content
  // version, only ever populated once a human has APPROVED that visual (see
  // packages/agents/visual/src/reviewVisualAsset.ts) — never an unreviewed image.
  // Null/omitted means "no visual" or "visual not yet approved", in which case the
  // site's own Thumbnail.astro falls back to its generated placeholder graphic, the
  // same behavior every blog post had before the visual agent existed.
  heroImageUrl?: string | null | undefined;
  heroImageAlt?: string | null | undefined;
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
