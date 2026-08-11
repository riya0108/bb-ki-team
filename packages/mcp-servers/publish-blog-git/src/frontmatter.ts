export interface PostFrontmatter {
  title: string;
  seoTitle?: string;
  description: string;
  category: string;
  tags: string[];
  pubDate: string;
  author: { name: string; bio: string };
  draft: boolean;
}

/**
 * Hand-rolled YAML frontmatter — the shape is small and fully controlled by
 * us, so JSON.stringify for scalar values (double-quoted YAML strings follow
 * JSON escaping rules) is a safe, dependency-free way to get correct
 * escaping without pulling in a YAML library. Matches the site's own
 * existing frontmatter style (e.g. `author: { name: "...", bio: "..." }`
 * inline flow mapping).
 */
export function buildFrontmatter(fm: PostFrontmatter): string {
  const lines = [
    `title: ${JSON.stringify(fm.title)}`,
    ...(fm.seoTitle ? [`seoTitle: ${JSON.stringify(fm.seoTitle)}`] : []),
    `description: ${JSON.stringify(fm.description)}`,
    `category: ${fm.category}`,
    `tags: [${fm.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    `pubDate: ${fm.pubDate}`,
    `author: { name: ${JSON.stringify(fm.author.name)}, bio: ${JSON.stringify(fm.author.bio)} }`,
    `draft: ${String(fm.draft)}`,
  ];
  return `---\n${lines.join('\n')}\n---\n`;
}
