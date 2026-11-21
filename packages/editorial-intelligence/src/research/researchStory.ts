import type { Logger } from '@bb/core';
import type { FetchTool } from '@bb/mcp-client';
import { contentStems, sharedStemCount } from '@bb/qa-gate';
import type { EvidenceSource, EvidenceSourceKind, EvidenceTier } from '@bb/shared-types';

import type { DiscoveredLead } from './claudeDiscovery.js';
import { quotesFoundIn } from './claudeDiscovery.js';
import type { FeedItem } from './feeds.js';
import { NEWS_SEARCH_FEEDS, parseRssItems, PRIMARY_FEEDS, splitPublisherSuffix } from './feeds.js';
import { isDiscoveryOnlyUrl, publisherForUrl, TIER_RANK, tierForPublisher, tierForUrl } from './sourceTiers.js';

// Spec 9/59: "Find what happened" — gather evidence, never write. Every fetch goes
// through the agent's scoped fetch MCP tool and is logged; an inaccessible URL is
// recorded as a failure and skipped, never replaced with guessed content.

export interface ResearchDocument {
  source: EvidenceSource;
  text: string;
}

// Material the caller already has (a source-discovery article, a pasted source,
// user-supplied text) — included as evidence ahead of anything searched.
export interface ProvidedDocument {
  kind: EvidenceSourceKind;
  text: string;
  url: string | null;
  title: string | null;
  publisher: string | null;
  tier: EvidenceTier;
}

export interface ResearchDossier {
  documents: ResearchDocument[];
  queries: string[];
  documentsConsidered: number;
  failures: { url: string; reason: string }[];
}

export interface ResearchStoryInput {
  topic: string;
  queries: string[];
  userUrls: string[];
  providedDocuments: ProvidedDocument[];
  // Trusted-sources registry rows already judged relevant to this topic.
  registrySources?: { url: string; name: string; tier: EvidenceTier }[];
  // Leads from agentic discovery (claudeDiscovery.ts). Each is re-fetched here
  // through the scoped fetch tool; the lead itself is never evidence.
  discoveredLeads?: readonly DiscoveredLead[];
  // Characters kept per discovered document (large-context writers read more).
  maxDiscoveredDocumentChars?: number;
  fetchTool: FetchTool;
  logger: Logger;
  runId: string;
  // Upper bounds keep a research pass to a handful of fetches (spec 46: cost control).
  maxSearchQueries?: number;
  maxArticleFetches?: number;
  maxSnippetDocuments?: number;
}

const DEFAULT_MAX_SEARCH_QUERIES = 2;
const DEFAULT_MAX_ARTICLE_FETCHES = 4;
const DEFAULT_MAX_SNIPPETS = 8;
const MAX_DOCUMENT_CHARS = 6000;
const STEP_ID = 'editorial-research';

function isRelevant(text: string, topicStems: readonly string[]): boolean {
  const shared = sharedStemCount(contentStems(text), topicStems);
  return shared >= 2 || (shared >= 1 && topicStems.length <= 2);
}

export async function researchStory(input: ResearchStoryInput): Promise<ResearchDossier> {
  const { fetchTool, logger, runId } = input;
  const documents: ResearchDocument[] = [];
  const failures: { url: string; reason: string }[] = [];
  const seenUrls = new Set<string>();
  const seenHeadlines = new Set<string>();
  let considered = 0;
  const topicStems = contentStems([input.topic, ...input.queries].join(' '));

  const addDocument = (doc: Omit<EvidenceSource, 'id'>, text: string, maxChars = MAX_DOCUMENT_CHARS): void => {
    documents.push({
      source: { id: `source_${documents.length + 1}`, ...doc },
      text: text.slice(0, maxChars),
    });
  };

  const fetchText = async (url: string, purpose: string): Promise<{ text: string; title: string | null; fetchedAt: string } | null> => {
    logger.info({ runId, stepId: STEP_ID, url, purpose }, 'Editorial research fetch');
    try {
      const result = await fetchTool.fetchUrl(url);
      return { text: result.text, title: result.title, fetchedAt: result.fetchedAt };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn({ runId, stepId: STEP_ID, url, purpose, err: reason }, 'Editorial research fetch failed, skipping');
      failures.push({ url, reason });
      return null;
    }
  };

  // 1. Material the caller already holds.
  for (const provided of input.providedDocuments) {
    considered += 1;
    if (provided.url) seenUrls.add(provided.url);
    addDocument(
      {
        kind: provided.kind,
        url: provided.url,
        title: provided.title,
        publisher: provided.publisher,
        tier: provided.tier,
        publishedAt: null,
        fetchedAt: null,
      },
      provided.text,
    );
  }

  // 2. Links the user pasted into their request.
  for (const url of input.userUrls) {
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    considered += 1;
    const fetched = await fetchText(url, 'user-supplied link');
    if (!fetched) continue;
    addDocument(
      {
        kind: 'fetched_article',
        url,
        title: fetched.title,
        publisher: publisherForUrl(url),
        tier: tierForUrl(url),
        publishedAt: null,
        fetchedAt: fetched.fetchedAt,
      },
      fetched.text,
    );
  }

  // 2a. Leads from agentic discovery: fetched like user links. The lead's own
  // quoted passages lead the document only when found verbatim in the fetched page,
  // so the long tail of a page (where survey methodology usually lives) is not lost
  // to truncation. An unfetchable lead is kept as a discovery-tier note at most.
  for (const lead of input.discoveredLeads ?? []) {
    if (seenUrls.has(lead.url)) continue;
    seenUrls.add(lead.url);
    considered += 1;
    const fetched = await fetchText(lead.url, `research lead: ${lead.title}`);
    if (fetched && fetched.text.trim().length >= 200) {
      const quotes = lead.keyFacts.map((f) => f.verbatimQuote).filter((q): q is string => q !== null);
      const found = quotesFoundIn(quotes, fetched.text);
      if (quotes.length > found.length) {
        logger.info({ runId, stepId: STEP_ID, url: lead.url, quoted: quotes.length, found: found.length }, 'Dropped research-lead quotes not found in the fetched page');
      }
      const keyPassages = found.length > 0 ? `Key passages (verified present in this page):\n${found.map((q) => `- "${q}"`).join('\n')}\n\n` : '';
      addDocument(
        {
          kind: 'fetched_article',
          url: lead.url,
          title: fetched.title ?? lead.title,
          publisher: lead.publisher ?? publisherForUrl(lead.url),
          tier: tierForUrl(lead.url),
          publishedAt: lead.publishedDate,
          fetchedAt: fetched.fetchedAt,
        },
        `${keyPassages}${fetched.text}`,
        input.maxDiscoveredDocumentChars ?? MAX_DOCUMENT_CHARS,
      );
      continue;
    }
    addDocument(
      {
        kind: 'news_search_result',
        url: lead.url,
        title: lead.title,
        publisher: lead.publisher ?? publisherForUrl(lead.url),
        tier: 'discovery',
        publishedAt: lead.publishedDate,
        fetchedAt: null,
      },
      `${lead.title}\n(Research lead; the page could not be fetched, so nothing here is verified.)\n${lead.keyFacts.map((f) => `- ${f.fact}`).join('\n')}`,
    );
  }

  // 2b. Relevant entries from the trusted-sources registry.
  for (const registry of input.registrySources ?? []) {
    if (seenUrls.has(registry.url)) continue;
    seenUrls.add(registry.url);
    considered += 1;
    const fetched = await fetchText(registry.url, `trusted source: ${registry.name}`);
    if (!fetched || !isRelevant(fetched.text.slice(0, 20000), topicStems)) continue;
    addDocument(
      {
        kind: 'trusted_source',
        url: registry.url,
        title: fetched.title,
        publisher: registry.name,
        tier: isDiscoveryOnlyUrl(registry.url) ? 'discovery' : registry.tier,
        publishedAt: null,
        fetchedAt: fetched.fetchedAt,
      },
      fetched.text,
    );
  }

  // 3. Primary-source feeds relevant to the topic (regulator press releases).
  const articleCandidates: { url: string; tier: EvidenceTier; title: string | null; publisher: string | null; publishedAt: string | null }[] = [];
  for (const feed of PRIMARY_FEEDS) {
    if (!feed.appliesTo.test(`${input.topic} ${input.queries.join(' ')}`)) continue;
    const fetched = await fetchText(feed.url, `primary feed: ${feed.publisher}`);
    if (!fetched) continue;
    const items = parseRssItems(fetched.text).filter((i) => isRelevant(`${i.title} ${i.description}`, topicStems));
    for (const item of items.slice(0, 3)) {
      considered += 1;
      addDocument(
        {
          kind: 'primary_feed_item',
          url: item.link,
          title: item.title,
          publisher: feed.publisher,
          tier: 'primary',
          publishedAt: item.publishedAt,
          fetchedAt: fetched.fetchedAt,
        },
        `${item.title}\n${item.description}`,
      );
      if (item.link && !seenUrls.has(item.link)) {
        articleCandidates.push({ url: item.link, tier: 'primary', title: item.title, publisher: feed.publisher, publishedAt: item.publishedAt });
      }
    }
  }

  // 4. News search feeds — headlines/snippets for discovery, plus article links to fetch.
  const snippetItems: (FeedItem & { tier: EvidenceTier })[] = [];
  for (const query of input.queries.slice(0, input.maxSearchQueries ?? DEFAULT_MAX_SEARCH_QUERIES)) {
    for (const feed of NEWS_SEARCH_FEEDS) {
      const fetched = await fetchText(feed.buildUrl(query), `news search: ${feed.name}`);
      if (!fetched) continue;
      for (const item of parseRssItems(fetched.text)) {
        const { headline, publisher: suffixPublisher } = splitPublisherSuffix(item.title);
        const publisher = item.publisher ?? suffixPublisher;
        const key = headline.toLowerCase();
        if (seenHeadlines.has(key) || !isRelevant(`${headline} ${item.description}`, topicStems)) continue;
        seenHeadlines.add(key);
        considered += 1;
        const isDirectArticle = item.link !== null && !item.link.includes('news.google.com');
        const tier =
          isDirectArticle && item.link ? maxTier(tierForUrl(item.link), tierForPublisher(publisher)) : tierForPublisher(publisher);
        snippetItems.push({ ...item, title: headline, publisher, tier });
        if (isDirectArticle && item.link && !seenUrls.has(item.link)) {
          articleCandidates.push({ url: item.link, tier, title: headline, publisher, publishedAt: item.publishedAt });
        }
      }
    }
  }

  // Search snippets are kept as their own low-weight evidence: verifyClaims never lets
  // a snippet alone make a claim VERIFIED.
  snippetItems
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])
    .slice(0, input.maxSnippetDocuments ?? DEFAULT_MAX_SNIPPETS)
    .forEach((item) => {
      addDocument(
        {
          kind: 'news_search_result',
          url: item.link,
          title: item.title,
          publisher: item.publisher,
          tier: item.tier,
          publishedAt: item.publishedAt,
          fetchedAt: null,
        },
        `${item.title}\n${item.description}`,
      );
    });

  // 5. Fetch the most authoritative article pages in full.
  const toFetch = dedupeByUrl(articleCandidates)
    .filter((c) => c.tier !== 'discovery')
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])
    .slice(0, input.maxArticleFetches ?? DEFAULT_MAX_ARTICLE_FETCHES);
  for (const candidate of toFetch) {
    seenUrls.add(candidate.url);
    const fetched = await fetchText(candidate.url, 'article');
    if (!fetched || fetched.text.trim().length < 200) continue;
    addDocument(
      {
        kind: 'fetched_article',
        url: candidate.url,
        title: fetched.title ?? candidate.title,
        publisher: candidate.publisher ?? publisherForUrl(candidate.url),
        tier: candidate.tier,
        publishedAt: candidate.publishedAt,
        fetchedAt: fetched.fetchedAt,
      },
      fetched.text,
    );
  }

  logger.info(
    { runId, stepId: STEP_ID, documents: documents.length, considered, failures: failures.length },
    'Editorial research complete',
  );
  return { documents, queries: input.queries, documentsConsidered: considered, failures };
}

function maxTier(a: EvidenceTier, b: EvidenceTier): EvidenceTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
}
