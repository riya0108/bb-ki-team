import { contentStems, sharedStemCount } from '@bb/qa-gate';
import type { EditorialArchitecture, EditorialWarning } from '@bb/shared-types';

import type { DraftBlogArticleWriterOutput } from '../draftArticle.js';

import { articleProse, presentComponentTypes, wordCount } from './articleText.js';

// Spec 12/13/15/33/50 J: deterministic structure checks — does the article match the
// depth it was planned at without padding, does the conclusion do more than repeat the
// introduction, does a deep piece actually engage a counterargument, are headings doing
// work. These produce warnings for the critic/editor; only "block" severity ones force a
// revision.

const SECTION_LIMITS: Record<EditorialArchitecture['articleDepth'], [number, number]> = {
  short_explainer: [2, 5],
  standard: [3, 7],
  deep_analysis: [4, 10],
  investigation: [5, 12],
};

const COUNTER_HEADING = /\b(counter|the case against|but what if|what could go wrong|the other side|bear case|bull case|skeptic|sceptic|limits?|caveat|not so fast|the catch|devil)/i;
const COUNTER_LANGUAGE = /\b(critics|sceptics|skeptics|the counterargument|on the other hand|the case against|that said|to be fair|the other reading|bear case|bull case|doesn't prove|does not prove|cuts the other way)\b/i;

export function checkStructure(draft: DraftBlogArticleWriterOutput, architecture: EditorialArchitecture | null): EditorialWarning[] {
  const warnings: EditorialWarning[] = [];
  const prose = articleProse(draft);
  const words = wordCount(prose);

  if (architecture) {
    const [min, max] = architecture.targetWordRange;
    if (words > max * 1.3) {
      warnings.push({ code: 'too_long', severity: 'warn', message: `${words} words against a ${min}-${max} plan — cut what doesn't earn its place.` });
    }
    if (words < min * 0.55) {
      warnings.push({ code: 'too_thin', severity: 'warn', message: `${words} words against a ${min}-${max} plan — the article may be skipping the mechanism or context.` });
    }
    const [minSections, maxSections] = SECTION_LIMITS[architecture.articleDepth];
    if (draft.sections.length > maxSections) {
      warnings.push({ code: 'too_many_sections', severity: 'warn', message: `${draft.sections.length} sections is a lot for a ${architecture.articleDepth}.` });
    }
    if (draft.sections.length < minSections) {
      warnings.push({ code: 'too_few_sections', severity: 'warn', message: `${draft.sections.length} sections may be too few for a ${architecture.articleDepth}.` });
    }
    const needsCounter = architecture.counterArgument !== null && architecture.articleDepth !== 'short_explainer';
    const hasCounter = draft.sections.some((s) => COUNTER_HEADING.test(s.heading)) || COUNTER_LANGUAGE.test(prose);
    if (needsCounter && !hasCounter) {
      warnings.push({
        code: 'missing_counterargument',
        severity: 'block',
        message: `The plan's counterargument ("${architecture.counterArgument ?? ''}") is never engaged.`,
      });
    }
    // Components the decision engine rejected must not appear.
    const allowed = new Set(architecture.componentDecisions.filter((d) => d.decision === 'USE').map((d) => d.type));
    const unapproved = presentComponentTypes(draft).filter((t) => !allowed.has(t as never));
    if (unapproved.length > 0) {
      warnings.push({ code: 'unapproved_components', severity: 'warn', message: `Removed components the plan did not approve: ${unapproved.join(', ')}.` });
    }
  }

  // The conclusion should change understanding, not restate the opening (spec 15/33).
  const opening = draft.sections[0]?.body.split(/\n{2,}/).slice(0, 2).join(' ') ?? '';
  const openingStems = contentStems(opening);
  const conclusionStems = contentStems(draft.conclusion);
  if (conclusionStems.length >= 6 && openingStems.length >= 6) {
    const overlap = sharedStemCount(conclusionStems, openingStems) / conclusionStems.length;
    if (overlap >= 0.6) {
      warnings.push({ code: 'conclusion_repeats_intro', severity: 'warn', message: 'The conclusion largely repeats the introduction.' });
    }
  }

  // Repeated headings or a heading that just restates the title do no work.
  const headings = draft.sections.map((s) => s.heading.trim().toLowerCase());
  if (new Set(headings).size < headings.length) {
    warnings.push({ code: 'duplicate_headings', severity: 'warn', message: 'Two sections share a heading.' });
  }

  if (draft.metaDescription.length > 170) {
    warnings.push({ code: 'meta_too_long', severity: 'warn', message: `Meta description is ${draft.metaDescription.length} characters (aim for under 160).` });
  }
  return warnings;
}
