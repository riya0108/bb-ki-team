import type { ArticleDepth, ComponentDecision, ComponentScores, ComponentType, EditorialBrief, EditorialMemory } from '@bb/shared-types';
import { COMPONENT_LIMITS, INTERACTIVE_COMPONENT_TYPES, isUsableClaim, MAX_INTERACTIVE_WIDGETS } from '@bb/shared-types';

// Spec 22/23: the writer never picks widgets at random. The planner proposes
// components with 0-10 scores; this module decides USE / DO NOT USE deterministically,
// so "a plain paragraph is better than a widget that doesn't improve understanding" is
// enforced in code rather than hoped for in a prompt.

export interface ComponentProposal {
  type: ComponentType;
  purpose: string;
  claimIds: string[];
  afterSectionIndex: number | null;
  scores: ComponentScores;
}

// Components whose content is factual and therefore need verified claims behind them.
const FACT_BEARING: ReadonlySet<ComponentType> = new Set(['table', 'quiz', 'timeline', 'comparisonStat', 'revealCards']);

const MAX_COMPONENTS_BY_DEPTH: Record<ArticleDepth, number> = {
  short_explainer: 2,
  standard: 3,
  deep_analysis: 4,
  investigation: 5,
};

const USE_THRESHOLD = 5.5;

export function componentScore(s: ComponentScores): number {
  const raw =
    s.informationGain * 0.25 +
    s.readerValue * 0.2 +
    s.topicFit * 0.15 +
    s.evidenceSupport * 0.2 +
    s.editorialNecessity * 0.15 +
    s.engagementValue * 0.05 -
    s.redundancy * 0.2;
  return Math.round(raw * 100) / 100;
}

export interface DecideComponentsInput {
  proposals: readonly ComponentProposal[];
  brief: EditorialBrief | null;
  depth: ArticleDepth;
  // Live editorial memories: a CONFIRMED/INFERRED "avoid component:X" vetoes or
  // penalises X; a REJECTED "prefer component:X" is never treated as a preference.
  memories?: readonly EditorialMemory[];
}

function memoryAdjustment(type: ComponentType, memories: readonly EditorialMemory[]): { veto: boolean; delta: number; note: string | null } {
  const relevant = memories.filter((m) => m.subject === `component:${type}` && m.supersededById === null);
  const avoid = relevant.find((m) => m.polarity === 'avoid' && (m.status === 'CONFIRMED' || m.status === 'INFERRED'));
  if (avoid?.status === 'CONFIRMED') return { veto: true, delta: 0, note: `editorial memory: ${avoid.statement}` };
  if (avoid) return { veto: false, delta: -1, note: `editorial memory (tentative): ${avoid.statement}` };
  const prefer = relevant.find((m) => m.polarity === 'prefer' && m.status === 'CONFIRMED');
  if (prefer) return { veto: false, delta: 0.5, note: `editorial memory: ${prefer.statement}` };
  return { veto: false, delta: 0, note: null };
}

export function decideComponents(input: DecideComponentsInput): ComponentDecision[] {
  const usableIds = new Set((input.brief?.claims ?? []).filter(isUsableClaim).map((c) => c.id));
  const memories = input.memories ?? [];

  // One proposal per type (the strongest), spec 23's "duplicate widgets are handled".
  const bestByType = new Map<ComponentType, ComponentProposal>();
  for (const p of input.proposals) {
    const current = bestByType.get(p.type);
    if (!current || componentScore(p.scores) > componentScore(current.scores)) bestByType.set(p.type, p);
  }

  const evaluated = [...bestByType.values()].map((p) => {
    const claimIds = p.claimIds.filter((id) => usableIds.has(id));
    const reasons: string[] = [];
    let eligible = true;
    if (FACT_BEARING.has(p.type) && claimIds.length === 0) {
      eligible = false;
      reasons.push('no verified claims to build it from');
    }
    if (p.scores.evidenceSupport < 6 && FACT_BEARING.has(p.type)) {
      eligible = false;
      reasons.push('evidence support too weak');
    }
    if (p.scores.editorialNecessity < 5) {
      eligible = false;
      reasons.push('not editorially necessary');
    }
    if (p.scores.redundancy >= 7) {
      eligible = false;
      reasons.push('repeats what the prose already says');
    }
    const memory = memoryAdjustment(p.type, memories);
    if (memory.veto) {
      eligible = false;
      reasons.push(memory.note ?? 'vetoed by editorial memory');
    } else if (memory.note) reasons.push(memory.note);
    const total = componentScore(p.scores) + memory.delta;
    if (total < USE_THRESHOLD) {
      eligible = false;
      reasons.push(`score ${total.toFixed(2)} below ${USE_THRESHOLD}`);
    }
    return { proposal: p, claimIds, eligible, total, reasons };
  });

  // Apply limits greedily, strongest first.
  const maxTotal = MAX_COMPONENTS_BY_DEPTH[input.depth];
  let used = 0;
  let interactive = 0;
  const perType = new Map<ComponentType, number>();
  const decisions = evaluated
    .sort((a, b) => b.total - a.total)
    .map((e): ComponentDecision => {
      let use = e.eligible;
      const reasons = [...e.reasons];
      const type = e.proposal.type;
      if (use && used >= maxTotal) {
        use = false;
        reasons.push(`a ${input.depth} article carries at most ${maxTotal} components`);
      }
      if (use && (perType.get(type) ?? 0) >= COMPONENT_LIMITS[type]) {
        use = false;
        reasons.push(`limit of ${COMPONENT_LIMITS[type]} ${type}`);
      }
      if (use && INTERACTIVE_COMPONENT_TYPES.includes(type) && interactive >= MAX_INTERACTIVE_WIDGETS) {
        use = false;
        reasons.push(`at most ${MAX_INTERACTIVE_WIDGETS} interactive widgets per article`);
      }
      if (use) {
        used += 1;
        perType.set(type, (perType.get(type) ?? 0) + 1);
        if (INTERACTIVE_COMPONENT_TYPES.includes(type)) interactive += 1;
      }
      return {
        type,
        decision: use ? 'USE' : 'DO_NOT_USE',
        purpose: e.proposal.purpose,
        scores: e.proposal.scores,
        total: Math.round(e.total * 100) / 100,
        claimIds: e.claimIds,
        afterSectionIndex: e.proposal.afterSectionIndex,
        reason: use ? (reasons.length > 0 ? `Improves understanding. ${reasons.join('; ')}` : 'Improves understanding.') : reasons.join('; '),
      };
    });
  return decisions;
}

// Writer output may only carry components the decision engine approved.
export function allowedComponentTypes(decisions: readonly ComponentDecision[]): Set<ComponentType> {
  return new Set(decisions.filter((d) => d.decision === 'USE').map((d) => d.type));
}
