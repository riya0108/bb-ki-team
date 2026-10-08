import type { EvidenceTier, SourceTier } from '@bb/shared-types';

// Spec section 9's evidence tiers. Lower tiers can help *discover* a story but never
// count as authoritative on their own — verifyClaims caps a claim's status by the best
// tier of evidence actually found for it.

const PRIMARY_DOMAINS = [
  'rbi.org.in',
  'sebi.gov.in',
  'pib.gov.in',
  'gov.in',
  'nic.in',
  'bseindia.com',
  'nseindia.com',
  'npci.org.in',
  'irdai.gov.in',
  'sec.gov',
  'federalreserve.gov',
  'gov',
  'gov.uk',
  'europa.eu',
  'ecb.europa.eu',
  'imf.org',
  'worldbank.org',
  'bis.org',
  'who.int',
  'oecd.org',
  'un.org',
  'ilo.org',
  'wto.org',
  'unctad.org',
  // Official sports bodies (medal tables, results) are the primary record for sport.
  'olympics.com',
  'ocasia.org',
];

const SECONDARY_DOMAINS = [
  'reuters.com',
  'apnews.com',
  'bloomberg.com',
  'ft.com',
  'wsj.com',
  'bbc.com',
  'bbc.co.uk',
  'cnbc.com',
  'nytimes.com',
  'theguardian.com',
  'economist.com',
  'economictimes.indiatimes.com',
  'livemint.com',
  'business-standard.com',
  'thehindubusinessline.com',
  'thehindu.com',
  'financialexpress.com',
  'moneycontrol.com',
  'ndtvprofit.com',
  'indianexpress.com',
  'hindustantimes.com',
  'cnbctv18.com',
];

const SPECIALIST_DOMAINS = [
  'techcrunch.com',
  'theverge.com',
  'arstechnica.com',
  'inc42.com',
  'entrackr.com',
  'the-ken.com',
  'medianama.com',
  'morningstar.com',
  'morningstar.in',
  'spglobal.com',
  'moodys.com',
  'fitchratings.com',
  'crisil.com',
  'icra.in',
  'valueresearchonline.com',
  'nber.org',
  'ourworldindata.org',
  'pewresearch.org',
];

// Tier 4: useful to discover a claim, never to establish one — even when a registry
// row or a publisher-name lookup would otherwise rank them higher.
const DISCOVERY_ONLY_DOMAINS = [
  'wikipedia.org',
  'reddit.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'quora.com',
  'medium.com',
  'substack.com',
  'youtube.com',
  'blogspot.com',
  'wordpress.com',
];

const PUBLISHER_TIERS: Record<string, EvidenceTier> = {
  'reserve bank of india': 'primary',
  rbi: 'primary',
  sebi: 'primary',
  'press information bureau': 'primary',
  reuters: 'secondary',
  'associated press': 'secondary',
  'ap news': 'secondary',
  bloomberg: 'secondary',
  'financial times': 'secondary',
  'the wall street journal': 'secondary',
  'wall street journal': 'secondary',
  bbc: 'secondary',
  'bbc news': 'secondary',
  cnbc: 'secondary',
  'cnbc tv18': 'secondary',
  'cnbctv18.com': 'secondary',
  'the economic times': 'secondary',
  'economic times': 'secondary',
  mint: 'secondary',
  livemint: 'secondary',
  'business standard': 'secondary',
  'the hindu businessline': 'secondary',
  'the hindu': 'secondary',
  'financial express': 'secondary',
  'the financial express': 'secondary',
  moneycontrol: 'secondary',
  'moneycontrol.com': 'secondary',
  'ndtv profit': 'secondary',
  'the indian express': 'secondary',
  'hindustan times': 'secondary',
  'the new york times': 'secondary',
  'the guardian': 'secondary',
  'the economist': 'secondary',
  techcrunch: 'specialist',
  'the verge': 'specialist',
  inc42: 'specialist',
  entrackr: 'specialist',
  'the ken': 'specialist',
  medianama: 'specialist',
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function tierForUrl(url: string): EvidenceTier {
  const host = hostOf(url);
  if (!host) return 'discovery';
  if (DISCOVERY_ONLY_DOMAINS.some((d) => matchesDomain(host, d))) return 'discovery';
  if (PRIMARY_DOMAINS.some((d) => matchesDomain(host, d))) return 'primary';
  if (SECONDARY_DOMAINS.some((d) => matchesDomain(host, d))) return 'secondary';
  if (SPECIALIST_DOMAINS.some((d) => matchesDomain(host, d))) return 'specialist';
  return 'discovery';
}

export function isDiscoveryOnlyUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && DISCOVERY_ONLY_DOMAINS.some((d) => matchesDomain(host, d));
}

export function tierForPublisher(name: string | null): EvidenceTier {
  if (!name) return 'discovery';
  return PUBLISHER_TIERS[name.trim().toLowerCase()] ?? 'discovery';
}

// The trusted-sources registry's own tiers (packages/db's sources table).
export function tierForRegistrySource(tier: SourceTier): EvidenceTier {
  if (tier === 'tier_1_primary') return 'primary';
  if (tier === 'tier_2_secondary') return 'secondary';
  return 'discovery';
}

export const TIER_RANK: Record<EvidenceTier, number> = { primary: 3, secondary: 2, specialist: 1, discovery: 0 };

export function publisherForUrl(url: string): string | null {
  return hostOf(url);
}
