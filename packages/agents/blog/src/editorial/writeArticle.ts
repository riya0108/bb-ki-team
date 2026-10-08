import type { LlmClient, Logger } from '@bb/core';
import { revisionNotesFor } from '@bb/editorial-intelligence';
import type { DriftIssue } from '@bb/qa-gate';
import { detectMeaningDrift } from '@bb/qa-gate';
import type { ComponentType, EditorialArchitecture, EditorialBrief, EditorialQuality, EditorialWarning } from '@bb/shared-types';

import type { DraftBlogArticleWriterOutput } from '../draftArticle.js';

import { articlePlainText, slopInputOf } from './articleText.js';
import type { ComponentEvidenceIssue } from './componentEvidence.js';
import { checkComponentEvidence, dropUnsupportedComponents } from './componentEvidence.js';
import type { CritiqueResult } from './critic.js';
import { critiqueArticle } from './critic.js';
import type { SlopReport } from './slopFilter.js';
import { checkAiSlop } from './slopFilter.js';
import { checkStructure } from './structureChecks.js';

// Spec 15/25/50: FIRST DRAFT -> deterministic checks + EDITORIAL CRITIC -> (if a hard
// gate fails) FINAL EDITOR revision -> re-check. One revision by default: every LLM
// call is paid for out of a free-tier quota, and a draft that still fails after the
// final editor goes to the human with the failures listed (QA BLOCKED), never
// silently "fixed" or presented as publish-ready.

const COMPONENT_FIELDS: Record<ComponentType, keyof DraftBlogArticleWriterOutput> = {
  table: 'table',
  revealCards: 'revealCards',
  quiz: 'quiz',
  poll: 'poll',
  decision: 'decision',
  comparisonStat: 'comparisonStat',
  pullQuote: 'pullQuote',
  timeline: 'timeline',
};

// The writer may only carry components the decision engine approved.
export function enforceAllowedComponents(draft: DraftBlogArticleWriterOutput, architecture: EditorialArchitecture | null): DraftBlogArticleWriterOutput {
  if (!architecture) return draft;
  const allowed = new Set(architecture.componentDecisions.filter((d) => d.decision === 'USE').map((d) => d.type));
  const next = { ...draft } as Record<string, unknown>;
  for (const [type, field] of Object.entries(COMPONENT_FIELDS) as [ComponentType, string][]) {
    if (!allowed.has(type)) next[field] = null;
  }
  return next as DraftBlogArticleWriterOutput;
}

export interface DraftChecks {
  slop: SlopReport;
  drift: DriftIssue[];
  componentIssues: ComponentEvidenceIssue[];
  structure: EditorialWarning[];
}

export function runDraftChecks(draft: DraftBlogArticleWriterOutput, brief: EditorialBrief | null, architecture: EditorialArchitecture | null): DraftChecks {
  return {
    slop: checkAiSlop(slopInputOf(draft)),
    drift: brief && brief.kind !== 'opinion' ? detectMeaningDrift(articlePlainText(draft), brief.claims) : [],
    componentIssues: checkComponentEvidence(draft, brief),
    structure: checkStructure(draft, architecture),
  };
}

function blockingNotes(checks: DraftChecks): string[] {
  return [
    ...checks.slop.findings.filter((f) => f.severity === 'block').map((f) => `${f.message}${f.evidence.length > 0 ? ` (${f.evidence.slice(0, 5).join('; ')})` : ''}`),
    ...revisionNotesFor(checks.drift),
    ...checks.componentIssues.map((i) => `The ${i.component} ${i.detail}: fix it from the verified claims or set the component to null.`),
    ...checks.structure.filter((w) => w.severity === 'block').map((w) => w.message),
  ];
}

// Evidence quality is capped by the research itself — rewriting can't raise it, so it
// never triggers a revision on its own (it still fails the final gate).
const NOT_WRITER_FIXABLE_PREFIX = 'evidenceQualityScore';

export interface WriteArticleInput {
  write: (revisionNotes: readonly string[], previous: DraftBlogArticleWriterOutput | null) => Promise<DraftBlogArticleWriterOutput>;
  brief: EditorialBrief | null;
  architecture: EditorialArchitecture | null;
  llm: LlmClient;
  logger: Logger;
  runId: string;
  maxRevisions?: number;
}

export interface WriteArticleResult {
  draft: DraftBlogArticleWriterOutput;
  checks: DraftChecks;
  critic: CritiqueResult | null;
  quality: EditorialQuality | null;
  revisions: number;
  droppedComponents: string[];
  warnings: EditorialWarning[];
}

export async function writeArticleWithEditorialLoop(input: WriteArticleInput): Promise<WriteArticleResult> {
  const maxRevisions = input.maxRevisions ?? 1;
  let draft = enforceAllowedComponents(await input.write([], null), input.architecture);
  let revisions = 0;
  let checks = runDraftChecks(draft, input.brief, input.architecture);
  let critic: CritiqueResult | null;

  for (;;) {
    critic = await critiqueArticle({
      articleText: articlePlainText(draft),
      architecture: input.architecture,
      brief: input.brief,
      findings: {
        slopRisk: checks.slop.riskScore,
        slopNotes: checks.slop.findings.map((f) => f.message),
        driftIssues: checks.drift.length,
        componentEvidenceIssues: checks.componentIssues.length,
        structureBlocks: checks.structure.filter((w) => w.severity === 'block').map((w) => w.message),
      },
      llm: input.llm,
      logger: input.logger,
      runId: input.runId,
      stepId: `blog-critic-${revisions}`,
    });
    const fixableFailures = (critic?.failures ?? []).filter((f) => !f.startsWith(NOT_WRITER_FIXABLE_PREFIX));
    const blocking = blockingNotes(checks);
    if ((blocking.length === 0 && fixableFailures.length === 0) || revisions >= maxRevisions) break;

    const notes = [
      ...blocking,
      ...(fixableFailures.length > 0 ? [`Editorial critic hard thresholds failed: ${fixableFailures.join(', ')}.`] : []),
      ...(critic?.revisionNotes ?? []),
      ...checks.slop.findings.filter((f) => f.severity === 'warn').map((f) => f.message),
      ...checks.structure.filter((w) => w.severity === 'warn').map((w) => w.message),
    ];
    input.logger.info({ runId: input.runId, stepId: 'blog-final-editor', notes: notes.length }, 'Draft failed editorial gates; running the final editor');
    try {
      draft = enforceAllowedComponents(await input.write(notes, draft), input.architecture);
    } catch (error) {
      input.logger.warn(
        { runId: input.runId, stepId: 'blog-final-editor', err: error instanceof Error ? error.message : String(error) },
        'Final editor revision failed; keeping the previous draft',
      );
      break;
    }
    revisions += 1;
    checks = runDraftChecks(draft, input.brief, input.architecture);
  }

  // Widgets that still don't hold up after the final editor are removed, not published.
  const { draft: finalDraft, dropped } = dropUnsupportedComponents(draft, checks.componentIssues);
  if (dropped.length > 0) checks = runDraftChecks(finalDraft, input.brief, input.architecture);

  const warnings: EditorialWarning[] = [
    ...checks.slop.findings.map((f): EditorialWarning => ({ code: `slop.${f.code}`, severity: f.severity, message: f.message })),
    ...checks.drift.map((d): EditorialWarning => ({ code: `drift.${d.rule}`, severity: 'block', message: d.explanation })),
    ...checks.structure,
    ...dropped.map((c): EditorialWarning => ({ code: 'component_dropped', severity: 'warn', message: `Removed the ${c}: its content could not be traced to verified claims.` })),
    ...(critic === null ? [{ code: 'critic_unavailable', severity: 'warn' as const, message: 'The editorial critic could not run; quality scores are missing for this draft.' }] : []),
    ...(critic?.failures ?? []).map((f): EditorialWarning => ({ code: 'critic_threshold', severity: 'block', message: `Editorial quality below the bar: ${f}.` })),
  ];
  return { draft: finalDraft, checks, critic, quality: critic?.quality ?? null, revisions, droppedComponents: dropped, warnings };
}
