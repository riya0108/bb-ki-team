import { z } from 'zod';

// The Claim Ledger — every statement the content system believes it can say about a
// story, with its evidence and verification state. Distinct from the spec 2.4 claim
// taxonomy in @bb/core's BRAND_BRAIN (FACT / ATTRIBUTED_CLAIM / INTERPRETATION / ...):
// that taxonomy governs how a claim is *worded* in final copy; ClaimType here is the
// finer-grained research classification the verifier and meaning-preservation QA need
// (a DATE, a NUMBER and a CAUSE fail in different ways).

export const ClaimTypeSchema = z.enum([
  'FACT',
  'STATISTIC',
  'DATE',
  'NUMBER',
  'QUOTE',
  'ATTRIBUTION',
  'EVENT',
  'CAUSE',
  'EFFECT',
  'FORECAST',
  'OPINION',
  'INTERPRETATION',
  'COMPARISON',
  'RANKING',
  'SUPERLATIVE',
  'ALLEGATION',
  'RUMOR',
  'SPECULATION',
]);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const VerificationStatusSchema = z.enum([
  'VERIFIED',
  'HIGH_CONFIDENCE',
  'PARTIALLY_VERIFIED',
  'DISPUTED',
  'UNVERIFIED',
  'FALSE',
  'OUTDATED',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

// Statuses a writer may state as (attributed) fact. Everything else must either be
// left out or carry its uncertainty explicitly.
export const USABLE_VERIFICATION_STATUSES: readonly VerificationStatus[] = ['VERIFIED', 'HIGH_CONFIDENCE'];

// Research evidence tiers (spec: primary > high-quality secondary > specialist >
// discovery-only). Separate from SourceTierSchema, which classifies rows in the
// trusted-sources registry rather than individual pieces of evidence.
export const EvidenceTierSchema = z.enum(['primary', 'secondary', 'specialist', 'discovery']);
export type EvidenceTier = z.infer<typeof EvidenceTierSchema>;

export const EvidenceSourceKindSchema = z.enum([
  'fetched_article',
  'news_search_result',
  'primary_feed_item',
  'trusted_source',
  'user_text',
]);
export type EvidenceSourceKind = z.infer<typeof EvidenceSourceKindSchema>;

// One piece of research material a claim can cite. `id` is a run-local handle
// ("source_1", ...) — the LLM cites these, never URLs it might invent.
export const EvidenceSourceSchema = z.object({
  id: z.string().min(1),
  kind: EvidenceSourceKindSchema,
  url: z.string().nullable(),
  title: z.string().nullable(),
  publisher: z.string().nullable(),
  tier: EvidenceTierSchema,
  publishedAt: z.string().nullable(),
  fetchedAt: z.string().nullable(),
});
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

// Spec section 8 — the temporal/modal state of what a claim describes. Meaning
// preservation QA compares a draft against this: "first_since" must never become
// "recurring", "expected"/"possible"/"proposed" must never become "completed".
export const TemporalStatusSchema = z.enum([
  'completed',
  'ongoing',
  'recurring',
  'first_since',
  'expected',
  'possible',
  'proposed',
  'approved',
  'announced',
  'effective',
  'historical',
  'unspecified',
]);
export type TemporalStatus = z.infer<typeof TemporalStatusSchema>;

export const TemporalContextSchema = z.object({
  status: TemporalStatusSchema,
  // The exact qualifier carrying the temporal meaning, e.g. "first time since 2023",
  // "from October 1", "next month". null when the claim has none.
  qualifier: z.string().nullable(),
  claimDate: z.string().nullable(),
  sourceDate: z.string().nullable(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
});
export type TemporalContext = z.infer<typeof TemporalContextSchema>;

export const ClaimEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  // Verbatim excerpt from that source supporting the claim. Checked deterministically
  // against the fetched text before a claim can be marked VERIFIED.
  quote: z.string().min(1),
  // Set by the deterministic verifier: whether `quote` was actually found in the
  // cited source's text. Never trusted from the model.
  quoteFound: z.boolean().default(false),
});
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>;

export const ClaimOriginSchema = z.enum(['research', 'user']);
export type ClaimOrigin = z.infer<typeof ClaimOriginSchema>;

export const ClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: ClaimTypeSchema,
  verificationStatus: VerificationStatusSchema,
  confidence: z.number().min(0).max(1),
  // 1-10 editorial importance, set by the significance analyst's ranking.
  importance: z.number().int().min(1).max(10),
  origin: ClaimOriginSchema,
  sourceIds: z.array(z.string()).default([]),
  evidence: z.array(ClaimEvidenceSchema).default([]),
  entities: z.array(z.string()).default([]),
  numbers: z.array(z.string()).default([]),
  dates: z.array(z.string()).default([]),
  temporalContext: TemporalContextSchema,
  // Who said/reported it, when the claim is only true *as an attribution*
  // ("according to Reuters", "the minister said"). Dropping it in copy is an
  // attribution failure.
  attributedTo: z.string().nullable().default(null),
  // Editorially critical facts ("first since 2023", "25 basis points", "proposed, not
  // approved") whose meaning writers must not transform.
  mustPreserve: z.boolean(),
  // Paraphrases known to keep the meaning intact — guidance for writers, not a whitelist.
  allowedParaphrase: z.array(z.string()).default([]),
  conflictingClaimIds: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
});
export type Claim = z.infer<typeof ClaimSchema>;

export function isUsableClaim(claim: Pick<Claim, 'verificationStatus'>): boolean {
  return USABLE_VERIFICATION_STATUSES.includes(claim.verificationStatus);
}
