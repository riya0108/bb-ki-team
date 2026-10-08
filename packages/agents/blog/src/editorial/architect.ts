import type { LlmClient, Logger } from '@bb/core';
import { renderBriefForWriter } from '@bb/editorial-intelligence';
import type { ArticleDepth, EditorialArchitecture, EditorialBrief, EditorialMemory } from '@bb/shared-types';
import {
  ArticleDepthSchema,
  ComponentScoresSchema,
  ComponentTypeSchema,
  DEPTH_WORD_RANGES,
  EditorialArchitectureSchema,
  isUsableClaim,
  PriorCoverageDecisionSchema,
  SectionPlanSchema,
} from '@bb/shared-types';
import { z } from 'zod';

import type { ComponentProposal } from './componentDecision.js';
import { decideComponents } from './componentDecision.js';

// Spec 12/24: the outline comes before the prose. One planner call turns the verified
// brief into an article architecture (thesis, angles, reader question, mechanism,
// counterargument, section plan, depth, what the article must not claim, component
// proposals); deterministic code then validates every claim ID against the ledger,
// caps depth by how much verified material exists (never pad), and decides components.

const ArchitectResponseSchema = z.object({
  thesis: z.string().min(1),
  primaryAngle: z.string().min(1),
  secondaryAngle: z.string().nullable().default(null),
  readerQuestion: z.string().min(1),
  hiddenMechanism: z.string().nullable().default(null),
  counterArgument: z.string().nullable().default(null),
  bullCase: z.string().nullable().default(null),
  bearCase: z.string().nullable().default(null),
  whatWeDontKnow: z.array(z.string()).default([]),
  keyFactClaimIds: z.array(z.string()).default([]),
  keyNumberClaimIds: z.array(z.string()).default([]),
  sectionPlan: z.array(SectionPlanSchema).min(2).max(12),
  articleDepth: ArticleDepthSchema,
  mustNotClaim: z.array(z.string()).default([]),
  componentProposals: z
    .array(
      z.object({
        type: ComponentTypeSchema,
        purpose: z.string(),
        claimIds: z.array(z.string()).default([]),
        afterSectionIndex: z.number().int().min(0).nullable().default(null),
        scores: ComponentScoresSchema,
      }),
    )
    .max(8)
    .default([]),
  priorCoverageDecision: PriorCoverageDecisionSchema.default('new_article'),
  editorialConfidence: z.number().min(0).max(1),
});
type ArchitectResponse = z.infer<typeof ArchitectResponseSchema>;

const DEPTH_ORDER: ArticleDepth[] = ['short_explainer', 'standard', 'deep_analysis', 'investigation'];

// Never plan deeper than the verified material can carry.
export function maxDepthFor(brief: EditorialBrief | null): ArticleDepth {
  if (!brief || brief.kind === 'opinion') return 'deep_analysis';
  if (brief.kind === 'insufficient_evidence') return 'short_explainer';
  const usable = brief.claims.filter(isUsableClaim).length;
  if (usable <= 2) return 'short_explainer';
  if (usable <= 5) return 'standard';
  if (usable <= 9) return 'deep_analysis';
  return 'investigation';
}

function capDepth(depth: ArticleDepth, cap: ArticleDepth): ArticleDepth {
  return DEPTH_ORDER.indexOf(depth) <= DEPTH_ORDER.indexOf(cap) ? depth : cap;
}

function buildSystemPrompt(): string {
  return `ROLE: blog-article-architect
You are the editor-in-chief of Bull or Bear planning ONE article before anyone writes it. You do not
write prose. You decide what the article argues and how it is built, using ONLY the verified brief.

Think like an investigative editor: What happened? Why? What changed? Why does it matter and to whom?
What does the data show, and what does it NOT show? What is the common explanation, and is it complete?
What is the hidden mechanism? What is the strongest argument against our reading (what evidence would
make it wrong)? What happens next, and what should the reader watch?

Produce:
- thesis: the one-sentence argument. A real point of view, never a hot take the claims can't carry.
- primaryAngle / secondaryAngle, readerQuestion (the question the reader leaves able to answer).
- hiddenMechanism, counterArgument (strongest case against the thesis, from the brief), bullCase /
  bearCase when interpretations genuinely compete (else null), whatWeDontKnow.
- keyFactClaimIds / keyNumberClaimIds: IDs of VERIFIED or HIGH_CONFIDENCE claims only.
- articleDepth: short_explainer (700-1,000 words), standard (1,200-1,800), deep_analysis (1,800-3,000)
  or investigation (2,500-4,000+), decided by complexity, number of verified claims, controversy,
  reader knowledge and significance. Completeness, never word count.
- sectionPlan: ordered sections, each {role, purpose, headingIdea, claimIds}. Roles: basic_facts,
  missing_question, what_data_shows, mechanism, counterargument, what_it_means, what_to_watch,
  context, history, comparison, practical, other. Adapt to the topic: do not force all of them.
- mustNotClaim: statements the writer will be tempted to make that the evidence does not support.
- componentProposals: interactive/visual components that would GENUINELY improve understanding
  (table, revealCards, quiz, poll, decision, comparisonStat, pullQuote, timeline). For each give purpose,
  the claimIds it would rest on, afterSectionIndex and 0-10 scores: informationGain, readerValue,
  topicFit, evidenceSupport, engagementValue, redundancy (10 = repeats the prose), editorialNecessity.
  Score honestly: most articles need zero to two components. A table only for real comparisons; a quiz
  only to reinforce what the article teaches; a decision only for a genuine trade-off; a timeline only
  when chronology matters. Never propose a component just because it exists.
- priorCoverageDecision (see PRIOR COVERAGE), editorialConfidence 0-1.
Respect the editorial memory and style profile below; never copy any reference writer.`;
}

export interface PlanArticleInput {
  topic: string;
  articleType: string;
  constraints: string | null;
  brief: EditorialBrief | null;
  styleGuidance: string;
  coverageNote: string;
  memories: readonly EditorialMemory[];
  llm: LlmClient;
  logger: Logger;
  runId: string;
}

export function reconcileArchitecture(
  response: ArchitectResponse,
  input: Pick<PlanArticleInput, 'brief' | 'memories'>,
): EditorialArchitecture {
  const usable = new Set((input.brief?.claims ?? []).filter(isUsableClaim).map((c) => c.id));
  const keep = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => usable.has(id)))];
  const depth = capDepth(response.articleDepth, maxDepthFor(input.brief));
  const sectionCount = response.sectionPlan.length;
  const proposals: ComponentProposal[] = response.componentProposals.map((p) => ({
    ...p,
    afterSectionIndex: p.afterSectionIndex === null ? null : Math.min(p.afterSectionIndex, sectionCount - 1),
  }));
  return EditorialArchitectureSchema.parse({
    ...response,
    keyFactClaimIds: keep(response.keyFactClaimIds),
    keyNumberClaimIds: keep(response.keyNumberClaimIds),
    sectionPlan: response.sectionPlan.map((s) => ({ ...s, claimIds: keep(s.claimIds) })),
    articleDepth: depth,
    targetWordRange: DEPTH_WORD_RANGES[depth],
    mustNotClaim: [...response.mustNotClaim, ...(input.brief?.thingsNotToSay ?? [])].slice(0, 15),
    componentDecisions: decideComponents({ proposals, brief: input.brief, depth, memories: input.memories }),
    source: 'planner',
  });
}

// Planner unavailable (provider outage, quota): a conservative architecture built
// from the brief alone — no components, depth capped low, clearly marked.
export function fallbackArchitecture(topic: string, brief: EditorialBrief | null): EditorialArchitecture {
  const essence = brief?.storyEssence ?? null;
  const usable = (brief?.claims ?? []).filter(isUsableClaim).sort((a, b) => b.importance - a.importance);
  const depth = capDepth('standard', maxDepthFor(brief));
  const plan = [
    { role: 'basic_facts' as const, purpose: 'What happened, precisely.', headingIdea: 'What happened', claimIds: usable.slice(0, 3).map((c) => c.id) },
    ...(essence?.hiddenMechanism ? [{ role: 'mechanism' as const, purpose: 'How it works.', headingIdea: 'How it actually works', claimIds: [] }] : []),
    ...(essence?.strongestCounterargument ? [{ role: 'counterargument' as const, purpose: 'The best case against.', headingIdea: 'The other reading', claimIds: essence.counterEvidenceClaimIds }] : []),
    { role: 'what_it_means' as const, purpose: 'Why it matters to the reader.', headingIdea: 'What this means', claimIds: [] },
  ];
  return EditorialArchitectureSchema.parse({
    thesis: brief?.selectedAngle?.angle ?? essence?.whyItMatters ?? topic,
    primaryAngle: brief?.selectedAngle?.angle ?? topic,
    secondaryAngle: null,
    readerQuestion: essence?.whyItMatters ? `Why does this matter: ${essence.whyItMatters}` : `What is really going on with ${topic}?`,
    hiddenMechanism: essence?.hiddenMechanism ?? null,
    counterArgument: essence?.strongestCounterargument ?? null,
    bullCase: null,
    bearCase: null,
    whatWeDontKnow: essence?.openQuestions ?? [],
    keyFactClaimIds: brief?.keyFactClaimIds.filter((id) => usable.some((c) => c.id === id)) ?? [],
    keyNumberClaimIds: [],
    sectionPlan: plan,
    articleDepth: depth,
    targetWordRange: DEPTH_WORD_RANGES[depth],
    mustNotClaim: brief?.thingsNotToSay ?? [],
    componentDecisions: [],
    priorCoverageDecision: 'new_article',
    editorialConfidence: 0.3,
    source: 'fallback',
  });
}

export async function planArticle(input: PlanArticleInput): Promise<EditorialArchitecture> {
  const briefBlock = input.brief
    ? renderBriefForWriter(input.brief)
    : '(no editorial brief — opinion/analysis; plan without stating unverified facts)';
  try {
    const response = await input.llm.completeStructured(
      {
        system: buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: `Topic: ${input.topic}
Article type: ${input.articleType}
${input.constraints ? `User constraints (override inferred style, never accuracy): ${input.constraints}\n` : ''}
${briefBlock}

${input.coverageNote}

${input.styleGuidance}`,
          },
        ],
        runId: input.runId,
        stepId: 'blog-architect',
        temperature: 0.3,
        maxTokens: 3500,
      },
      ArchitectResponseSchema,
    );
    return reconcileArchitecture(response, input);
  } catch (error) {
    input.logger.warn(
      { runId: input.runId, stepId: 'blog-architect', err: error instanceof Error ? error.message : String(error) },
      'Article architect unavailable; using a conservative fallback architecture',
    );
    return fallbackArchitecture(input.topic, input.brief);
  }
}
