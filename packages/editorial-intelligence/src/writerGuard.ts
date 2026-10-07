import type { Logger } from '@bb/core';
import type { DriftIssue } from '@bb/qa-gate';
import { detectMeaningDrift } from '@bb/qa-gate';
import type { EditorialBrief } from '@bb/shared-types';

// Spec 44 ("if hook validation fails: regenerate") applied at the writer: if a platform
// draft drifts from the brief's claims (e.g. "first since 2023" -> "again"), redraft
// once with the exact problems listed. A draft that still drifts is returned as-is —
// final QA then fails it and it goes to human review, never silently "fixed".

export interface GuardedDraft<T> {
  draft: T;
  driftIssues: DriftIssue[];
  redrafted: boolean;
}

export function revisionNotesFor(issues: readonly DriftIssue[]): string[] {
  return issues.map((i) => `${i.explanation} Offending sentence: "${i.sentence}"`);
}

export async function draftWithMeaningGuard<T>(input: {
  brief: EditorialBrief | null;
  draft: (revisionNotes: readonly string[]) => Promise<T>;
  textOf: (draft: T) => string;
  logger: Logger;
  runId: string;
  stepId: string;
}): Promise<GuardedDraft<T>> {
  const first = await input.draft([]);
  if (!input.brief || input.brief.kind === 'opinion') return { draft: first, driftIssues: [], redrafted: false };

  const issues = detectMeaningDrift(input.textOf(first), input.brief.claims);
  if (issues.length === 0) return { draft: first, driftIssues: [], redrafted: false };

  input.logger.warn(
    { runId: input.runId, stepId: input.stepId, issues: issues.map((i) => i.rule) },
    'Draft drifted from the editorial brief; redrafting once',
  );
  const second = await input.draft(revisionNotesFor(issues));
  return { draft: second, driftIssues: detectMeaningDrift(input.textOf(second), input.brief.claims), redrafted: true };
}
