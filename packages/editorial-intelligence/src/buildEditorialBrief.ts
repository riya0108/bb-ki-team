import { createHash } from 'node:crypto';

import { BRAND_BRAIN } from '@bb/core';
import type {
  Claim,
  EditorialAngle,
  EditorialBrief,
  EditorialBriefKind,
  EvidenceSource,
  HookCandidate,
  ResearchSummary,
  RiskLevel,
  ScoredHook,
  StoryEssence,
  UserRequestAnalysis,
} from '@bb/shared-types';
import { EDITORIAL_BRIEF_SCHEMA_VERSION, EditorialBriefSchema, isUsableClaim } from '@bb/shared-types';

// Bumped whenever any editorial-intelligence prompt changes meaningfully, so a stored
// brief records which prompt generation produced it (spec 48: regression debugging).
export const EDITORIAL_PROMPT_VERSION = 'editorial-v1';

// Brand Brain is checked-in code, not a versioned DB row — a content hash identifies
// exactly which version of it a brief was built against.
export const BRAND_BRAIN_VERSION = createHash('sha256').update(JSON.stringify(BRAND_BRAIN)).digest('hex').slice(0, 12);

export class EditorialBriefValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Editorial brief failed validation: ${issues.join('; ')}`);
    this.name = 'EditorialBriefValidationError';
  }
}

export interface BuildEditorialBriefInput {
  id: string;
  runId: string;
  topic: string;
  topicKey: string;
  kind: EditorialBriefKind;
  riskLevel: RiskLevel;
  riskFlags: string[];
  userRequest: UserRequestAnalysis;
  research: ResearchSummary;
  sources: EvidenceSource[];
  claims: Claim[];
  storyEssence: StoryEssence | null;
  selectedAngle: EditorialAngle | null;
  hookCandidates: ScoredHook[];
  selectedHooks: HookCandidate[];
  thingsNotToSay: string[];
  uncertaintyNotes: string[];
  temporalNotes: string[];
  contentDnaVersion: number;
}

// Assembles the brief and validates it beyond its JSON shape (spec 15: valid JSON is
// not enough): every referenced claim ID must exist, selected hooks and the story's
// key facts must rest on usable claims, and protected facts must be in the ledger.
export function buildEditorialBrief(input: BuildEditorialBriefInput): EditorialBrief {
  const byId = new Map(input.claims.map((c) => [c.id, c]));
  const usable = input.claims.filter(isUsableClaim);
  const keyFactClaimIds = (input.storyEssence?.rankedFacts ?? [])
    .filter((r) => {
      const claim = byId.get(r.claimId);
      return claim !== undefined && isUsableClaim(claim);
    })
    .sort((a, b) => b.importance - a.importance)
    .map((r) => r.claimId);
  const fallbackKeyFacts = [...usable].sort((a, b) => b.importance - a.importance).map((c) => c.id);
  const protectedClaimIds = input.claims.filter((c) => c.mustPreserve).map((c) => c.id);

  const brief = EditorialBriefSchema.parse({
    id: input.id,
    schemaVersion: EDITORIAL_BRIEF_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    runId: input.runId,
    topic: input.topic,
    topicKey: input.topicKey,
    kind: input.kind,
    riskLevel: input.riskLevel,
    riskFlags: input.riskFlags,
    userRequest: input.userRequest,
    research: input.research,
    sources: input.sources,
    claims: input.claims,
    storyEssence: input.storyEssence,
    selectedAngle: input.selectedAngle,
    hookCandidates: input.hookCandidates,
    selectedHooks: input.selectedHooks,
    audience: input.selectedAngle?.audience ?? input.storyEssence?.affectedAudience[0] ?? null,
    emotionalMode: input.selectedAngle?.emotionalMode ?? null,
    keyFactClaimIds: (keyFactClaimIds.length > 0 ? keyFactClaimIds : fallbackKeyFacts).slice(0, 8),
    protectedClaimIds,
    thingsNotToSay: [...new Set(input.thingsNotToSay)],
    uncertaintyNotes: input.uncertaintyNotes,
    temporalNotes: input.temporalNotes,
    contentDnaVersion: input.contentDnaVersion,
    brandBrainVersion: BRAND_BRAIN_VERSION,
    promptVersion: EDITORIAL_PROMPT_VERSION,
  });

  const issues = validateBriefSemantics(brief);
  if (issues.length > 0) throw new EditorialBriefValidationError(issues);
  return brief;
}

export function validateBriefSemantics(brief: EditorialBrief): string[] {
  const issues: string[] = [];
  const byId = new Map(brief.claims.map((c) => [c.id, c]));
  const sourceIds = new Set(brief.sources.map((s) => s.id));
  const isUsableId = (id: string): boolean => {
    const c = byId.get(id);
    return c !== undefined && isUsableClaim(c);
  };

  if (new Set(brief.claims.map((c) => c.id)).size !== brief.claims.length) issues.push('duplicate claim IDs');
  for (const c of brief.claims) {
    for (const id of c.sourceIds) if (!sourceIds.has(id)) issues.push(`${c.id} cites unknown source ${id}`);
    if (isUsableClaim(c) && !c.evidence.some((e) => e.quoteFound)) issues.push(`${c.id} is ${c.verificationStatus} without found evidence`);
  }
  for (const h of brief.selectedHooks) {
    if (h.supportingClaimIds.length === 0 || !h.supportingClaimIds.every((id) => byId.has(id))) {
      issues.push(`hook ${h.id} references unknown claims`);
    }
    if (!h.supportingClaimIds.some(isUsableId)) issues.push(`hook ${h.id} rests on no usable claim`);
  }
  for (const id of [...brief.keyFactClaimIds, ...brief.protectedClaimIds]) {
    if (!byId.has(id)) issues.push(`unknown claim ${id} referenced`);
  }
  if (brief.storyEssence) {
    for (const id of [brief.storyEssence.mostImportantFactClaimId, brief.storyEssence.mostInterestingFactClaimId]) {
      if (!isUsableId(id)) issues.push(`story essence rests on non-usable claim ${id}`);
    }
  }
  if (brief.selectedAngle && !brief.selectedAngle.supportingClaimIds.some(isUsableId)) {
    issues.push('selected angle rests on no usable claim');
  }
  if (brief.kind === 'researched' && !brief.claims.some(isUsableClaim)) issues.push('researched brief has no usable claims');
  return issues;
}
