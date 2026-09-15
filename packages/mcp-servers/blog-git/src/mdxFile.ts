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
    'draft: false',
    '---',
  ];
  return `${frontmatterLines.join('\n')}\n\n${bodyMdx.trim()}\n`;
}
