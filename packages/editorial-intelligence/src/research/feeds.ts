// Free, keyless discovery feeds, fetched through the existing fetch MCP tool (never a
// direct HTTP call from agent code). Search feeds only *discover* candidate articles
// and headlines; primary feeds (regulator press releases) are first-party evidence.
//
// NOTE: Google News and Bing News RSS are published for personal, non-commercial feed
// reading. Remove them from NEWS_SEARCH_FEEDS (one line each) if that use isn't
// acceptable for this deployment — research then falls back to primary feeds, the
// trusted-sources registry and user-supplied links/text.

export interface NewsSearchFeed {
  name: string;
  buildUrl(query: string): string;
}

export const NEWS_SEARCH_FEEDS: readonly NewsSearchFeed[] = [
  {
    name: 'Google News',
    buildUrl: (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`,
  },
  {
    name: 'Bing News',
    buildUrl: (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&mkt=en-IN`,
  },
];

export interface PrimaryFeed {
  publisher: string;
  url: string;
  // Only consulted when the topic matches — no point scanning SEBI's feed for an RBI story.
  appliesTo: RegExp;
}

export const PRIMARY_FEEDS: readonly PrimaryFeed[] = [
  {
    publisher: 'Reserve Bank of India',
    url: 'https://www.rbi.org.in/pressreleases_rss.xml',
    appliesTo: /\b(rbi|reserve bank|repo rate|repo|monetary policy|mpc|crr|slr|upi)\b/i,
  },
  {
    publisher: 'SEBI',
    url: 'https://www.sebi.gov.in/sebirss.xml',
    appliesTo: /\b(sebi|securities and exchange board|mutual funds?|ipo|f&o|derivatives)\b/i,
  },
];

export interface FeedItem {
  title: string;
  link: string | null;
  description: string;
  publishedAt: string | null;
  publisher: string | null;
  publisherUrl: string | null;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function stripCdata(text: string): string {
  return text.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
}

function cleanText(raw: string | undefined): string {
  if (!raw) return '';
  return decodeEntities(stripCdata(raw))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | undefined {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)?.[1];
}

// Bing wraps article links in a click-tracking redirect whose `url` parameter holds
// the real article URL — unwrap it so the article itself can be fetched and tiered.
export function unwrapRedirect(link: string): string {
  try {
    const parsed = new URL(link);
    const target = parsed.searchParams.get('url');
    if (target && /^https?:\/\//i.test(target)) return target;
  } catch {
    // not a URL — fall through
  }
  return link;
}

function isoDate(raw: string): string | null {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Minimal RSS 2.0 item parser — feeds are small, well-formed and only need
// title/link/description/date/source, so no XML dependency is warranted.
export function parseRssItems(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] ?? '';
    const title = cleanText(tag(block, 'title'));
    if (!title) continue;
    const linkRaw = cleanText(tag(block, 'link'));
    const sourceMatch = /<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i.exec(block);
    const pubDate = cleanText(tag(block, 'pubDate'));
    items.push({
      title,
      link: linkRaw ? unwrapRedirect(decodeEntities(linkRaw)) : null,
      description: cleanText(tag(block, 'description')),
      publishedAt: pubDate ? isoDate(pubDate) : null,
      publisher: sourceMatch?.[2] ? cleanText(sourceMatch[2]) : null,
      publisherUrl: sourceMatch?.[1] ?? null,
    });
  }
  return items;
}

// Google News appends " - Publisher" to every title; split it off so the headline
// text is clean and the publisher can be tiered.
export function splitPublisherSuffix(title: string): { headline: string; publisher: string | null } {
  const idx = title.lastIndexOf(' - ');
  if (idx <= 0) return { headline: title, publisher: null };
  return { headline: title.slice(0, idx).trim(), publisher: title.slice(idx + 3).trim() || null };
}
