import { extractQuantities, isMaterialQuantity, supportFor } from '@bb/qa-gate';
import type { Claim, EditorialBrief } from '@bb/shared-types';
import { isUsableClaim } from '@bb/shared-types';

import type { DraftBlogArticleWriterOutput } from '../draftArticle.js';

import { componentTexts } from './articleText.js';

// Spec 18/20/22: every factual cell, correct quiz answer, explanation, timeline entry
// and reveal inside an interactive component must trace back to verified claims — a
// widget is a published claim, not decoration. Deterministic: every material number in
// a component's factual text must be supported by a usable claim (its text, numbers,
// dates or found evidence), and every claim ID it cites must exist and be usable.

export interface ComponentEvidenceIssue {
  component: string;
  problem: 'unsupported_number' | 'unknown_claim' | 'unusable_claim' | 'no_evidence_base' | 'quiz_without_claims';
  detail: string;
}

// Hypothetical/illustrative text may use its own numbers (spec 17) — but only when it
// says so in the same sentence.
const HYPOTHETICAL = /\b(assume|assuming|suppose|imagine|hypothetical(ly)?|illustrative(ly)?|for illustration|say you|if you|let's say|for example, if|scenario)\b/i;

function evidenceText(claims: readonly Claim[]): string {
  return claims
    .flatMap((c) => [c.text, ...c.numbers, ...c.dates, ...c.evidence.filter((e) => e.quoteFound).map((e) => e.quote)])
    .join('\n');
}

export function checkComponentEvidence(draft: DraftBlogArticleWriterOutput, brief: EditorialBrief | null): ComponentEvidenceIssue[] {
  const issues: ComponentEvidenceIssue[] = [];
  const claims = brief?.claims ?? [];
  const byId = new Map(claims.map((c) => [c.id, c]));
  const usable = claims.filter(isUsableClaim);
  const evidenceQuantities = extractQuantities(evidenceText(usable));

  for (const component of componentTexts(draft)) {
    for (const id of new Set(component.claimIds)) {
      const claim = byId.get(id);
      if (!claim) issues.push({ component: component.type, problem: 'unknown_claim', detail: `cites ${id}, which is not in the claim ledger` });
      else if (!isUsableClaim(claim)) {
        issues.push({ component: component.type, problem: 'unusable_claim', detail: `cites ${id} (${claim.verificationStatus}), which may not be stated as fact` });
      }
    }

    for (const text of component.factual) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        if (component.type === 'decision' && HYPOTHETICAL.test(sentence)) continue;
        for (const q of extractQuantities(sentence).filter(isMaterialQuantity)) {
          if (usable.length === 0) {
            issues.push({ component: component.type, problem: 'no_evidence_base', detail: `"${q.raw}" appears but the brief has no verified claims to support numbers` });
          } else if (supportFor(q, evidenceQuantities) !== 'supported') {
            issues.push({ component: component.type, problem: 'unsupported_number', detail: `"${q.raw}" is not in any verified claim` });
          }
        }
      }
    }
  }

  // A quiz tests what the article verified; each question must name the claims its
  // answer rests on.
  if (draft.quiz && draft.quiz.questions.some((q) => q.claimIds.length === 0) && usable.length > 0) {
    issues.push({ component: 'quiz', problem: 'quiz_without_claims', detail: 'every quiz question must cite the verified claim its answer rests on' });
  }
  return issues;
}

// Removes components that still fail evidence after revision: an unsupported widget is
// dropped, never published (a plain paragraph beats a widget that doesn't hold up).
export function dropUnsupportedComponents(
  draft: DraftBlogArticleWriterOutput,
  issues: readonly ComponentEvidenceIssue[],
): { draft: DraftBlogArticleWriterOutput; dropped: string[] } {
  const failing = new Set(issues.filter((i) => i.problem !== 'unknown_claim').map((i) => i.component));
  if (failing.size === 0) return { draft, dropped: [] };
  const next: DraftBlogArticleWriterOutput = { ...draft };
  if (failing.has('table')) next.table = null;
  if (failing.has('quiz')) next.quiz = null;
  if (failing.has('decision')) next.decision = null;
  if (failing.has('timeline')) next.timeline = null;
  if (failing.has('revealCards')) next.revealCards = null;
  if (failing.has('comparisonStat')) next.comparisonStat = null;
  if (failing.has('poll')) next.poll = null;
  if (failing.has('pullQuote')) next.pullQuote = null;
  return { draft: next, dropped: [...failing] };
}
