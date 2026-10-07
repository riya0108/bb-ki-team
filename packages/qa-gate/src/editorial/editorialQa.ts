import type { LlmClient } from '@bb/core';
import type { Claim, EditorialBrief, EditorialQaResult, QaDimensionResult } from '@bb/shared-types';
import { isUsableClaim } from '@bb/shared-types';
import { z } from 'zod';

import { classifyHighRiskTopic } from '../deterministic/highRiskTopic.js';

import type { DriftIssue } from './meaningDrift.js';
import { detectMeaningDrift } from './meaningDrift.js';
import type { Quantity } from './quantities.js';
import { extractQuantities, isMaterialQuantity, supportFor } from './quantities.js';
import { contentStems, normalizeForMatch, sharedStemCount, splitSentences } from './text.js';

// Spec 27/28/63: final fact/meaning QA for a draft written from an EditorialBrief.
// Deterministic checks run first and can never be overridden by the LLM; the LLM
// semantic check maps every material statement in the draft to claim IDs and catches
// drift the patterns can't. Either source failing a hard dimension fails it.

const IssueCategorySchema = z.enum(['meaning', 'temporal', 'entity', 'number', 'attribution', 'causality', 'unsupported']);

export const EditorialFactCheckSchema = z.object({
  materialClaims: z
    .array(
      z.object({
        text: z.string(),
        kind: z.enum(['fact', 'interpretation', 'opinion', 'prediction', 'question']),
        mappedClaimIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  issues: z
    .array(
      z.object({
        category: IssueCategorySchema,
        draftText: z.string(),
        claimId: z.string().nullable().default(null),
        explanation: z.string(),
      }),
    )
    .default([]),
  missingProtectedClaimIds: z.array(z.string()).default([]),
  openingClaimIds: z.array(z.string()).default([]),
  crossPlatformIssues: z.array(z.object({ platform: z.string(), explanation: z.string() })).default([]),
});
export type EditorialFactCheck = z.infer<typeof EditorialFactCheckSchema>;

export interface SiblingDraft {
  platform: string;
  text: string;
}

export interface RunEditorialQaInput {
  draft: string;
  // The draft's opening line / hook. Defaults to the first sentence of `draft`.
  opening?: string;
  brief: EditorialBrief;
  siblingDrafts: readonly SiblingDraft[];
  platform: string;
  llm: LlmClient;
  runId: string;
  stepId: string;
}

const pass = (notes: string): QaDimensionResult => ({ status: 'PASS', notes });
const warn = (notes: string, evidence?: string[]): QaDimensionResult =>
  evidence && evidence.length > 0 ? { status: 'WARN', notes, evidence } : { status: 'WARN', notes };
const fail = (notes: string, evidence?: string[]): QaDimensionResult =>
  evidence && evidence.length > 0 ? { status: 'FAIL', notes, evidence } : { status: 'FAIL', notes };

function describeClaims(claims: readonly Claim[], protectedIds: ReadonlySet<string>): string {
  return claims
    .map(
      (c) =>
        `- ${c.id} [${c.type}, ${c.verificationStatus}${protectedIds.has(c.id) ? ', MUST PRESERVE' : ''}, temporal: ${c.temporalContext.status}${c.temporalContext.qualifier ? ` "${c.temporalContext.qualifier}"` : ''}${c.attributedTo ? `, attributed to ${c.attributedTo}` : ''}] ${c.text}`,
    )
    .join('\n');
}

function buildFactCheckSystemPrompt(platform: string): string {
  return `ROLE: editorial-fact-qa
You are the final fact and meaning checker for a Bull or Bear ${platform} draft. You do not edit or
rewrite. You compare the draft against a ledger of research claims and report problems.

For every material statement in the draft (anything a reader would take as a claim about the world),
return it in materialClaims with kind fact / interpretation / opinion / prediction / question and the
ledger claim IDs it rests on (empty if none). A "fact" with no supporting ledger claim is a problem.

Report an issue for anything that changes meaning relative to the ledger, in particular:
- temporal: "first since X" turned into "again"/"another"/"resumed"/"continues"; a completed event
  turned into "may/could/will"; "expected/planned" turned into done; old turned into current.
- meaning: "proposed" turned into "imposed/policy"; "alleged" turned into "did"; "could/may" turned
  into "will"; a qualifier dropped so the claim becomes stronger than the evidence.
- number: a number, unit, period (YoY vs MoM) or currency that differs from the ledger, or a number
  that is not in the ledger at all.
- entity: a wrong name, organisation, place or product.
- attribution: "according to X" stated as independently verified fact; a quote that is not exact.
- causality: "because/due to/led to/caused" where the ledger only establishes sequence or association.
- unsupported: a factual statement with no ledger support.
Only claims marked VERIFIED or HIGH_CONFIDENCE may be stated as fact. Others need explicit hedging.
List protected (MUST PRESERVE) claim IDs that the draft contradicts or that are central to the story
but missing in missingProtectedClaimIds. List the claim IDs the draft's opening line rests on in
openingClaimIds. If other platforms' drafts of the same story are supplied, report any factual
disagreement with them (numbers, dates, certainty, temporal wording, attribution) in crossPlatformIssues.
Never invent problems to seem thorough; an empty issues list is a valid answer.`;
}

function buildFactCheckUserPrompt(input: RunEditorialQaInput, opening: string): string {
  const protectedIds = new Set(input.brief.protectedClaimIds);
  const siblings =
    input.siblingDrafts.length > 0
      ? input.siblingDrafts.map((s) => `--- ${s.platform} draft ---\n${s.text.slice(0, 3000)}`).join('\n\n')
      : '(none)';
  return `Claim ledger:
${describeClaims(input.brief.claims, protectedIds)}

Opening line: ${opening}

Draft (${input.platform}):
${input.draft.slice(0, 12000)}

Other platforms' drafts of the same story:
${siblings}`;
}

function driftEvidence(issues: readonly DriftIssue[]): string[] {
  return issues.map((i) => `${i.explanation} [sentence: "${i.sentence}"]`);
}

function claimQuantities(claims: readonly Claim[]): Quantity[] {
  return claims.flatMap((c) =>
    extractQuantities([c.text, ...c.numbers, ...c.dates, ...c.evidence.map((e) => e.quote)].join(' \n ')),
  );
}

// Compares hook-ish text against the brief's approved hooks: an opening that is
// substantially one of them inherits that hook's claim traceability.
function matchesSelectedHook(opening: string, brief: EditorialBrief): boolean {
  const openingStems = contentStems(opening);
  if (openingStems.length === 0) return false;
  return brief.selectedHooks.some((h) => {
    const hookStems = contentStems(h.text);
    return sharedStemCount(openingStems, hookStems) / Math.max(hookStems.length, 1) >= 0.6;
  });
}

function fromLlm(
  issues: EditorialFactCheck['issues'] | null,
  category: z.infer<typeof IssueCategorySchema>,
): string[] {
  return (issues ?? []).filter((i) => i.category === category).map((i) => `${i.explanation} [draft: "${i.draftText}"]`);
}

export async function runEditorialQa(input: RunEditorialQaInput): Promise<EditorialQaResult> {
  const { brief, draft } = input;
  const opening = input.opening ?? splitSentences(draft)[0] ?? draft;
  const isHighRisk = brief.riskLevel === 'high' || classifyHighRiskTopic(draft).riskLevel === 'high';
  const claimsById = new Map(brief.claims.map((c) => [c.id, c]));

  // 1. Deterministic checks — the floor the LLM cannot raise.
  const drift = detectMeaningDrift(draft, brief.claims);
  const byCategory = (cat: DriftIssue['category']): DriftIssue[] => drift.filter((i) => i.category === cat);
  const usableClaims = brief.claims.filter(isUsableClaim);
  const evidenceQuantities = claimQuantities(usableClaims);
  const draftQuantities = extractQuantities(draft).filter(isMaterialQuantity);
  const unitMismatches = draftQuantities.filter((q) => supportFor(q, evidenceQuantities) === 'unit_mismatch');
  const unsupportedNumbers = draftQuantities.filter((q) => supportFor(q, evidenceQuantities) === 'unsupported');
  const forbiddenHits = brief.thingsNotToSay.filter(
    (phrase) => phrase.split(/\s+/).length <= 6 && normalizeForMatch(draft).includes(normalizeForMatch(phrase)),
  );

  // 2. LLM semantic check. A failure here degrades to WARN on the dimensions that
  // need it — never to a fabricated PASS, never to a crash of the whole QA gate.
  let check: EditorialFactCheck | null;
  try {
    check = await input.llm.completeStructured(
      {
        system: buildFactCheckSystemPrompt(input.platform),
        messages: [{ role: 'user', content: buildFactCheckUserPrompt(input, opening) }],
        runId: input.runId,
        stepId: `${input.stepId}-editorial-fact-check`,
        temperature: 0,
      },
      EditorialFactCheckSchema,
    );
  } catch {
    check = null;
  }
  const semanticUnavailable = 'Semantic fact check could not run; deterministic checks only — review manually.';

  // Never trust model-supplied IDs: only count mappings to claims that exist.
  const mapsToUsable = (ids: readonly string[]): boolean =>
    ids.some((id) => {
      const c = claimsById.get(id);
      return c !== undefined && isUsableClaim(c);
    });

  const meaningEvidence = [
    ...driftEvidence(byCategory('meaning')),
    ...forbiddenHits.map((p) => `Uses a forbidden formulation: "${p}"`),
    ...fromLlm(check?.issues ?? null, 'meaning'),
  ];
  const meaningPreservation =
    meaningEvidence.length > 0
      ? fail('Draft changes the meaning of verified claims.', meaningEvidence)
      : check
        ? pass('No meaning drift against the claim ledger.')
        : warn(semanticUnavailable);

  const temporalEvidence = [...driftEvidence(byCategory('temporal')), ...fromLlm(check?.issues ?? null, 'temporal')];
  const temporalAccuracy =
    temporalEvidence.length > 0
      ? fail('Draft changes the temporal meaning of a claim.', temporalEvidence)
      : pass('Temporal wording is consistent with the claim ledger.');

  const entityEvidence = fromLlm(check?.issues ?? null, 'entity');
  const entityAccuracy =
    entityEvidence.length > 0
      ? fail('Draft names an entity inconsistently with the claim ledger.', entityEvidence)
      : check
        ? pass('Entities are consistent with the claim ledger.')
        : warn(semanticUnavailable);

  const numberEvidence = [
    ...unitMismatches.map((q) => `"${q.raw}" matches a ledger value but with a different unit.`),
    ...driftEvidence(byCategory('number')),
    ...fromLlm(check?.issues ?? null, 'number'),
  ];
  const numberAccuracy =
    numberEvidence.length > 0
      ? fail('Draft misstates a number, unit or period.', numberEvidence)
      : unsupportedNumbers.length > 0
        ? (isHighRisk ? fail : warn)(
            `${unsupportedNumbers.length} number(s) in the draft are not in any verified claim.`,
            unsupportedNumbers.map((q) => q.raw),
          )
        : pass('Every material number maps to a verified claim.');

  const attributionEvidence = [
    ...driftEvidence(byCategory('attribution')),
    ...fromLlm(check?.issues ?? null, 'attribution'),
  ];
  const attributionAccuracy =
    attributionEvidence.length > 0
      ? fail('Draft drops or alters attribution, or contains an unverified quote.', attributionEvidence)
      : pass('Attribution and quotations are preserved.');

  const hardCausal = byCategory('causality').filter((i) => i.rule !== 'unsupported_causality');
  const softCausal = byCategory('causality').filter((i) => i.rule === 'unsupported_causality');
  const llmCausal = fromLlm(check?.issues ?? null, 'causality');
  const causalityAccuracy =
    hardCausal.length > 0 || llmCausal.length > 0
      ? fail('Draft asserts causality the evidence does not establish.', [...driftEvidence(hardCausal), ...llmCausal])
      : softCausal.length > 0
        ? (isHighRisk ? fail : warn)('Causal wording not backed by a verified CAUSE claim.', driftEvidence(softCausal))
        : pass('No unsupported causal claims.');

  const untraced = (check?.materialClaims ?? []).filter((m) => m.kind === 'fact' && !mapsToUsable(m.mappedClaimIds));
  const unsupportedIssues = fromLlm(check?.issues ?? null, 'unsupported');
  const traceEvidence = [...untraced.map((m) => `Unmapped factual statement: "${m.text}"`), ...unsupportedIssues];
  const claimTraceability = !check
    ? warn(semanticUnavailable)
    : traceEvidence.length > 0
      ? (isHighRisk || brief.kind === 'insufficient_evidence' ? fail : warn)(
          'Some factual statements do not map to a verified claim.',
          traceEvidence,
        )
      : pass('Every material factual statement maps to a verified claim or is labeled interpretation/opinion.');

  const protectedIds = new Set(brief.protectedClaimIds);
  const missing = (check?.missingProtectedClaimIds ?? []).filter((id) => protectedIds.has(id));
  const claimCoverage = !check
    ? warn(semanticUnavailable)
    : missing.length > 0
      ? warn(
          'Protected key facts are missing or contradicted.',
          missing.map((id) => `${id}: ${claimsById.get(id)?.text ?? ''}`),
        )
      : pass('Protected key facts are covered.');

  const openingDrift = detectMeaningDrift(opening, brief.claims);
  const openingNumbers = extractQuantities(opening)
    .filter(isMaterialQuantity)
    .filter((q) => supportFor(q, evidenceQuantities) !== 'supported');
  const hookTraceability =
    openingDrift.length > 0 || openingNumbers.length > 0
      ? fail('The opening line contradicts or goes beyond the verified claims.', [
          ...driftEvidence(openingDrift),
          ...openingNumbers.map((q) => `Unsupported number in opening: "${q.raw}"`),
        ])
      : matchesSelectedHook(opening, brief) || mapsToUsable(check?.openingClaimIds ?? [])
        ? pass('The opening line is traceable to verified claims.')
        : warn('The opening line could not be traced to a verified claim or an approved hook.', [opening]);

  const siblingConflicts = input.siblingDrafts.flatMap((s) => {
    const siblingDrift = detectMeaningDrift(s.text, brief.claims);
    return siblingDrift.length > 0 && drift.length === 0
      ? [`${s.platform} draft contradicts the shared brief: ${siblingDrift[0]?.explanation ?? ''}`]
      : [];
  });
  const crossEvidence = [
    ...siblingConflicts,
    ...(check?.crossPlatformIssues ?? []).map((i) => `${i.platform}: ${i.explanation}`),
  ];
  const crossPlatformConsistency =
    input.siblingDrafts.length === 0
      ? pass('No other platform drafts of this story to compare against.')
      : crossEvidence.length > 0
        ? warn('Platform drafts of this story disagree on facts — review before approving either.', crossEvidence)
        : pass(`Consistent with ${input.siblingDrafts.length} other platform draft(s) of this story.`);

  return {
    briefId: brief.id,
    claimCoverage,
    claimTraceability,
    meaningPreservation,
    temporalAccuracy,
    entityAccuracy,
    numberAccuracy,
    attributionAccuracy,
    causalityAccuracy,
    hookTraceability,
    crossPlatformConsistency,
  };
}
