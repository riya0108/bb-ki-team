import type { Claim, EditorialAngle, RiskLevel, VerificationStatus } from '@bb/shared-types';
import { isUsableClaim } from '@bb/shared-types';

// Spec 15: choose the strongest TRUTHFUL angle — relevance, novelty, reader impact,
// evidence strength, curiosity and brand fit. Evidence strength is computed here from
// the claim ledger, never taken from the model, so a vivid angle resting on weak
// claims can't outrank a well-evidenced one.

const EVIDENCE_WEIGHT: Partial<Record<VerificationStatus, number>> = {
  VERIFIED: 10,
  HIGH_CONFIDENCE: 8,
  PARTIALLY_VERIFIED: 3,
};

export function evidenceStrength(angle: EditorialAngle, claimsById: ReadonlyMap<string, Claim>): number {
  const weights = angle.supportingClaimIds.map((id) => {
    const claim = claimsById.get(id);
    return claim ? (EVIDENCE_WEIGHT[claim.verificationStatus] ?? 0) : 0;
  });
  return weights.length === 0 ? 0 : weights.reduce((a, b) => a + b, 0) / weights.length;
}

export function scoreAngle(angle: EditorialAngle, claimsById: ReadonlyMap<string, Claim>): number {
  const base =
    0.2 * angle.relevance +
    0.15 * angle.novelty +
    0.2 * angle.readerImpact +
    0.25 * evidenceStrength(angle, claimsById) +
    0.1 * angle.curiosity +
    0.1 * angle.brandFit;
  return base + (angle.matchesUserIntent ? 1.5 : 0);
}

export function selectAngle(
  angles: readonly EditorialAngle[],
  claims: readonly Claim[],
  riskLevel: RiskLevel,
): EditorialAngle | null {
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const eligible = angles.filter((a) => {
    const supporting = a.supportingClaimIds.map((id) => claimsById.get(id)).filter((c): c is Claim => c !== undefined);
    if (!supporting.some(isUsableClaim)) return false;
    // High-risk topics: every supporting claim must be usable — no angle partly built on
    // an unverified claim.
    return riskLevel !== 'high' || supporting.every(isUsableClaim);
  });
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => scoreAngle(b, claimsById) - scoreAngle(a, claimsById))[0] ?? null;
}
