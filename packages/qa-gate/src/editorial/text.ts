// Small, dependency-free text utilities shared by the deterministic editorial checks.
// Deliberately crude (suffix-stripping, not real NLP): these checks only need to know
// whether a draft sentence is *about* the same thing as a claim, and then look for a
// handful of high-precision drift markers in it. The LLM semantic checker covers the
// long tail these patterns can't.

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'for', 'on', 'at', 'by', 'and', 'or', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'has', 'have', 'had', 'it', 'its', "it's", 'this', 'that', 'these', 'those',
  'with', 'as', 'from', 'just', 'than', 'then', 'so', 'if', 'your', 'you', 'our', 'their', 'they', 'we',
  'i', 'not', 'no', 'but', 'what', 'which', 'who', 'how', 'why', 'when', 'where', 'here', 'there', 'about',
  'into', 'over', 'up', 'down', 'out', 'more', 'most', 'some', 'any', 'all', 'can', 'do', 'does', 'did',
  'also', 'now', 'new', 'per', 'its', 'his', 'her', 'he', 'she', 'them', 'very', 'via', 'after', 'before',
  // Drift markers and modals are what the checks look *for*; counting them as shared
  // content would anchor unrelated sentences to a claim.
  'first', 'time', 'since', 'again', 'once', 'another', 'will', 'may', 'might', 'could', 'would', 'should',
  'expected', 'likely', 'said', 'says', 'according', 'reported', 'year', 'years',
]);

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/(\d),(?=\d)/g, '$1')
    .split(/[^a-z0-9'.%₹$]+/)
    .map((t) => t.replace(/^[.']+|[.']+$/g, '').replace(/'s$/, ''))
    .filter((t) => t.length > 0);
}

export function stem(word: string): string {
  let w = word;
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ied') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4 && !w.endsWith('ses')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  // "cutting" -> "cutt" -> "cut", "planned" -> "plann" -> "plan".
  if (w !== word && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1);
  return w;
}

export function contentStems(text: string): string[] {
  return [...new Set(tokenize(text).filter((t) => !STOPWORDS.has(t)).map(stem))];
}

export function sharedStemCount(a: readonly string[], b: readonly string[]): number {
  const set = new Set(b);
  return a.filter((s) => set.has(s)).length;
}

// Whether `sentence` talks about the same thing as a claim with these stems: at least
// two shared content stems, or one when the claim itself is very short.
export function isAnchored(sentenceStems: readonly string[], claimStems: readonly string[]): boolean {
  const shared = sharedStemCount(sentenceStems, claimStems);
  return shared >= 2 || (shared >= 1 && claimStems.length <= 3);
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"’'`]/g, '')
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
