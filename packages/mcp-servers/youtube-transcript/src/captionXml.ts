function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// YouTube's timedtext endpoint returns <transcript><text start=".." dur="..">line</text>...
// XML. This extracts just the spoken lines, in order, as one plain-text transcript —
// timing data isn't needed for repurposing into a written post.
export function parseTimedTextXml(xml: string): string {
  const matches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
  return matches
    .map((match) => decodeHtmlEntities((match[1] ?? '').replace(/\n/g, ' ').trim()))
    .filter((line) => line.length > 0)
    .join(' ');
}
