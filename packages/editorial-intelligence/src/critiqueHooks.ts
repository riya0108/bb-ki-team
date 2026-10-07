import type { LlmClient, Logger } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import {
  claimFeatures,
  contentStems,
  detectMeaningDrift,
  extractQuantities,
  isMaterialQuantity,
  normalizeForMatch,
  sharedStemCount,
  supportFor,
} from '@bb/qa-gate';
import type { Claim, HookCandidate, HookCritique, ScoredHook } from '@bb/shared-types';
import { HookCritiqueSchema, isUsableClaim } from '@bb/shared-types';
import { z } from 'zod';

// Spec 18/19: every candidate hook goes through two gates before it can be selected.
//   Deterministic (hard): supporting claims exist and are usable; no meaning drift
//     against the ledger (first-since -> again, may -> will, proposed -> imposed, ...);
//     every number supported with the right unit; no forbidden formulation.
//   LLM critic: factualAccuracy and meaningPreservation are hard gates; the remaining
//     scores rank the survivors.
// A hook that changes the meaning of a verified fact is rejected even if it scores
// highest on "viral" dimensions.

const CritiqueResponseSchema = z.object({ critiques: z.array(HookCritiqueSchema) });

const SCORE_WEIGHTS: Record<
  'specificity' | 'curiosity' | 'relevance' | 'readerImpact' | 'surprise' | 'clarity' | 'naturalness' | 'brandFit' | 'platformPotential',
  number
> = {
  specificity: 0.15,
  curiosity: 0.12,
  relevance: 0.13,
  readerImpact: 0.15,
  surprise: 0.08,
  clarity: 0.12,
  naturalness: 0.1,
  brandFit: 0.08,
  platformPotential: 0.07,
};

const ANGLE_ALIGNMENT_BONUS = 1;

export function deterministicHookIssues(hook: HookCandidate, claims: readonly Claim[], thingsNotToSay: readonly string[]): string[] {
  const issues: string[] = [];
  const byId = new Map(claims.map((c) => [c.id, c]));
  const supporting = hook.supportingClaimIds.map((id) => byId.get(id)).filter((c): c is Claim => c !== undefined);
  if (supporting.length === 0) issues.push('Not traceable to any claim in the ledger.');
  const unusable = supporting.filter((c) => !isUsableClaim(c));
  if (unusable.length > 0) {
    issues.push(`Rests on claims that are not verified: ${unusable.map((c) => `${c.id} (${c.verificationStatus})`).join(', ')}.`);
  }
  for (const drift of detectMeaningDrift(hook.text, claims)) issues.push(drift.explanation);

  const evidence = claims.filter(isUsableClaim).flatMap((c) => extractQuantities([c.text, ...c.numbers, ...c.dates].join(' \n ')));
  for (const q of extractQuantities(hook.text).filter(isMaterialQuantity)) {
    const support = supportFor(q, evidence);
    if (support !== 'supported') issues.push(`Number "${q.raw}" is ${support === 'unit_mismatch' ? 'in the wrong unit' : 'not in any verified claim'}.`);
  }
  for (const phrase of thingsNotToSay) {
    if (phrase.split(/\s+/).length <= 6 && normalizeForMatch(hook.text).includes(normalizeForMatch(phrase))) {
      issues.push(`Uses a forbidden formulation: "${phrase}".`);
    }
  }
  for (const word of BRAND_BRAIN.forbiddenPhrases) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(hook.text)) issues.push(`Uses brand-forbidden word "${word}".`);
  }
  if (/[—–]/.test(hook.text)) issues.push('Contains an em/en dash (brand rule: no em dashes).');
  return issues;
}

// Spec 40: strongly prefer hooks that carry the protected, most important facts (e.g.
// "first time since 2023") rather than dropping them for brevity.
export function protectedFactBonus(hook: HookCandidate, claims: readonly Claim[]): number {
  let bonus = 0;
  for (const claim of claims) {
    if (!claim.mustPreserve || !isUsableClaim(claim) || claim.importance < 9) continue;
    if (!hook.supportingClaimIds.includes(claim.id)) continue;
    const f = claimFeatures(claim);
    const qualifier = claim.temporalContext.qualifier;
    const qualifierCarried = qualifier
      ? sharedStemCount(contentStems(hook.text), contentStems(qualifier)) >= Math.min(1, contentStems(qualifier).length) &&
        (!f.isNovelty || /\bfirst\b/i.test(hook.text))
      : sharedStemCount(contentStems(hook.text), f.stems) >= 2;
    if (qualifierCarried) bonus += 1.5;
  }
  return bonus;
}

function weightedScore(c: HookCritique): number {
  return (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).reduce((sum, k) => sum + SCORE_WEIGHTS[k] * c[k], 0);
}

function buildSystemPrompt(platformHint: string): string {
  return `ROLE: editorial-hook-critic
You are a skeptical editor judging candidate opening lines against a verified claim ledger.
For each hook return:
- factualAccuracy (boolean, HARD GATE): false if anything in it is unsupported by the listed claims.
- meaningPreservation (boolean, HARD GATE): false if it changes the meaning of any claim — temporal
  ("first since 2023" -> "again"), certainty ("could" -> "will", "expected" -> "happened"), status
  ("proposed" -> "imposed"), attribution, causality, or units/periods. Sequence or causal framing
  ("before", "already", "after", "helped spark", "because", "led to") is false unless a claim
  explicitly states that order or cause.
Leaving a fact out is NOT a factual or meaning failure — a hook is one sentence and cannot carry every
number. Fail a gate only for something the hook states or implies that the claims do not support.
- specificity, curiosity, relevance, readerImpact, surprise, clarity, naturalness, brandFit,
  platformPotential (${platformHint}): 0-10.
- notes: one sentence.
A hook with a higher "viral" feel that fails either gate must still be marked false.`;
}

export interface CritiqueHooksInput {
  hooks: readonly HookCandidate[];
  claims: readonly Claim[];
  // Claims the selected angle rests on: hooks that open on the chosen story outrank
  // equally strong hooks about a side detail.
  angleClaimIds?: readonly string[];
  thingsNotToSay: readonly string[];
  llm: LlmClient;
  logger: Logger;
  runId: string;
  stepId?: string;
}

export async function critiqueHooks(input: CritiqueHooksInput): Promise<ScoredHook[]> {
  const stepId = input.stepId ?? 'editorial-hook-critique';
  const byId = new Map(input.claims.map((c) => [c.id, c]));
  let critiques = new Map<string, HookCritique>();
  try {
    const response = await input.llm.completeStructured(
      {
        system: buildSystemPrompt('X, LinkedIn and blog openings'),
        messages: [
          {
            role: 'user',
            content: `Claims:\n${input.claims
              .map((c) => `- ${c.id} [${c.verificationStatus}${c.mustPreserve ? ', MUST PRESERVE' : ''}] ${c.text}`)
              .join('\n')}\n\nHooks:\n${input.hooks
              .map((h) => `- ${h.id} (rests on ${h.supportingClaimIds.join(', ')}): ${h.text}`)
              .join('\n')}`,
          },
        ],
        runId: input.runId,
        stepId,
        temperature: 0,
      },
      CritiqueResponseSchema,
    );
    critiques = new Map(response.critiques.map((c) => [c.hookId, c]));
  } catch (error) {
    input.logger.warn(
      { runId: input.runId, stepId, err: error instanceof Error ? error.message : String(error) },
      'Hook critic LLM call failed — ranking on deterministic gates only',
    );
  }

  return input.hooks.map((hook): ScoredHook => {
    const reasons = deterministicHookIssues(hook, input.claims, input.thingsNotToSay);
    const critique = critiques.get(hook.id) ?? null;
    if (critique && !critique.factualAccuracy) reasons.push(`Critic: not factually accurate. ${critique.notes}`);
    if (critique && !critique.meaningPreservation) reasons.push(`Critic: changes meaning. ${critique.notes}`);
    const importance = Math.max(0, ...hook.supportingClaimIds.map((id) => byId.get(id)?.importance ?? 0));
    const onAngle = (input.angleClaimIds ?? []).some((id) => hook.supportingClaimIds.includes(id));
    const score =
      (critique ? weightedScore(critique) : 5) +
      protectedFactBonus(hook, input.claims) +
      importance * 0.05 +
      (onAngle ? ANGLE_ALIGNMENT_BONUS : 0);
    return { candidate: hook, critique, rejected: reasons.length > 0, rejectionReasons: reasons, score };
  });
}

export function rankAccepted(scored: readonly ScoredHook[]): ScoredHook[] {
  return scored.filter((s) => !s.rejected).sort((a, b) => b.score - a.score);
}

// Last-resort hook when every generated candidate was rejected twice: the most
// important usable claim, verbatim. Always true; possibly plain — the writer may
// sharpen the wording, QA still checks it.
export function fallbackHook(claims: readonly Claim[]): HookCandidate | null {
  const top = [...claims].filter(isUsableClaim).sort((a, b) => b.importance - a.importance)[0];
  if (!top) return null;
  return { id: 'hook_fallback', text: top.text, pattern: 'surprisingFact', supportingClaimIds: [top.id] };
}
