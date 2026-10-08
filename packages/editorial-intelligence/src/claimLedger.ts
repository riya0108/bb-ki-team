import { extractQuantities, normalizeForMatch } from '@bb/qa-gate';
import type { AllowedUse, Claim, ClaimLedgerEntry, EditorialBrief, EvidenceSource, EvidenceTier } from '@bb/shared-types';
import { isUsableClaim } from '@bb/shared-types';

import { TIER_RANK } from './research/sourceTiers.js';

// Spec 5: the reviewer-facing claim ledger. A pure projection of the brief's claims
// and sources — recomputed, never stored separately — so it can't drift from the
// verified record the writer and QA actually used.

const ATTRIBUTION_TYPES = new Set(['QUOTE', 'ATTRIBUTION', 'FORECAST', 'OPINION', 'ALLEGATION']);

export function allowedUseFor(claim: Claim): AllowedUse {
  if (claim.verificationStatus === 'FALSE' || claim.verificationStatus === 'OUTDATED') return 'do_not_use';
  if (!isUsableClaim(claim)) return claim.verificationStatus === 'UNVERIFIED' ? 'do_not_use' : 'hedge_as_uncertain';
  if (claim.attributedTo !== null || ATTRIBUTION_TYPES.has(claim.type)) return 'attribute';
  return 'state_as_fact';
}

function bestTier(sources: readonly EvidenceSource[]): EvidenceTier | null {
  return sources.reduce<EvidenceTier | null>((best, s) => (best === null || TIER_RANK[s.tier] > TIER_RANK[best] ? s.tier : best), null);
}

function currencyOf(unit: string): string | null {
  if (unit === 'inr') return 'INR';
  if (unit === 'usd') return 'USD';
  return null;
}

export function buildClaimLedger(brief: EditorialBrief): ClaimLedgerEntry[] {
  const sourcesById = new Map(brief.sources.map((s) => [s.id, s]));
  const groupOf = new Map<string, string>();
  for (const group of brief.research.syndicatedGroups) for (const id of group) groupOf.set(id, `group:${group[0] ?? id}`);

  return brief.claims.map((claim): ClaimLedgerEntry => {
    const supportingIds = [...new Set([...claim.sourceIds, ...claim.evidence.filter((e) => e.quoteFound).map((e) => e.sourceId)])];
    const sources = supportingIds.map((id) => sourcesById.get(id)).filter((s): s is EvidenceSource => s !== undefined);
    const foundEvidence = claim.evidence.filter((e) => e.quoteFound);
    const independent = new Set(
      foundEvidence
        .map((e) => sourcesById.get(e.sourceId))
        .filter((s): s is EvidenceSource => s !== undefined && s.tier !== 'discovery')
        .map((s) => groupOf.get(s.id) ?? s.publisher ?? s.url ?? s.id),
    );
    const primarySource = [...sources].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])[0] ?? null;
    const quantity = extractQuantities(claim.text).find((q) => q.unit !== 'year') ?? null;
    const publicationDates = sources.map((s) => s.publishedAt).filter((d): d is string => d !== null).sort();
    const contradictionStatus: ClaimLedgerEntry['contradictionStatus'] =
      claim.verificationStatus === 'DISPUTED' ? 'disputed' : claim.conflictingClaimIds.length > 0 ? 'conflicts' : 'none';

    return {
      claimId: claim.id,
      exactClaim: claim.text,
      normalizedClaim: normalizeForMatch(claim.text),
      claimType: claim.type,
      sourceIds: supportingIds,
      sourceUrls: [...new Set(sources.map((s) => s.url).filter((u): u is string => u !== null))],
      sourceTier: bestTier(sources),
      independentSourceCount: independent.size,
      publicationDate: publicationDates[publicationDates.length - 1] ?? null,
      evidenceDate: claim.temporalContext.claimDate ?? claim.dates[0] ?? null,
      confidence: claim.confidence,
      verificationStatus: claim.verificationStatus,
      contradictionStatus,
      temporalStatus: claim.temporalContext.status,
      temporalQualifier: claim.temporalContext.qualifier,
      geography: claim.geography ?? null,
      entity: claim.entities[0] ?? null,
      numericalValue: quantity ? quantity.value : null,
      unit: quantity ? quantity.unit : null,
      currency: quantity ? currencyOf(quantity.unit) : null,
      originalSource: claim.attributedTo ?? primarySource?.publisher ?? null,
      supportingQuote: foundEvidence[0]?.quote ?? null,
      allowedUse: allowedUseFor(claim),
      caveat: claim.notes,
      lastVerifiedAt: brief.createdAt,
    };
  });
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function displayDate(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Source';
  }
}

export interface SourceDisplayEntry {
  sourceId: string;
  label: string;
  url: string | null;
  tier: EvidenceTier;
  claimIds: string[];
}

// Spec 27: clean source references ("Reuters, October 8, 2026") for the article's
// Sources section — only sources that actually back a usable claim, best tier first.
export function buildSourceDisplay(brief: EditorialBrief): SourceDisplayEntry[] {
  const claimIdsBySource = new Map<string, string[]>();
  for (const claim of brief.claims.filter(isUsableClaim)) {
    for (const e of claim.evidence.filter((ev) => ev.quoteFound)) {
      claimIdsBySource.set(e.sourceId, [...new Set([...(claimIdsBySource.get(e.sourceId) ?? []), claim.id])]);
    }
  }
  const seenLabels = new Set<string>();
  return brief.sources
    // A user-supplied source document is cited as such even though it can't raise a
    // claim's tier on its own.
    .filter((s) => claimIdsBySource.has(s.id) && (s.tier !== 'discovery' || s.kind === 'user_text'))
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])
    .map((s): SourceDisplayEntry => {
      const who = s.publisher ?? (s.url ? hostLabel(s.url) : 'Source');
      const when = displayDate(s.publishedAt);
      const what = s.title && s.title.length <= 90 ? `: ${s.title}` : '';
      return { sourceId: s.id, label: `${who}${what}${when ? `, ${when}` : ''}`, url: s.url, tier: s.tier, claimIds: claimIdsBySource.get(s.id) ?? [] };
    })
    .filter((entry) => (seenLabels.has(entry.label) ? false : (seenLabels.add(entry.label), true)));
}
