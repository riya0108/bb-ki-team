import { contentStems, sharedStemCount } from '@bb/qa-gate';
import type { EditorialArchitecture, EditorialWarning } from '@bb/shared-types';

import { bodyCitedClaimIds } from '../bodyMarkup.js';
import type { DraftBlogArticleWriterOutput } from '../draftArticle.js';

import { articleProse, plainBody, presentComponentTypes, wordCount } from './articleText.js';

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

const COUNTER_HEADING = /\b(counter|objection|opposing|strongest case|steelman|rebuttal|pushback|the case against|but what if|what could go wrong|the other side|bear case|bull case|skeptic|sceptic|limits?|caveat|not so fast|the catch|devil)/i;
const COUNTER_LANGUAGE = /\b(critics|sceptics|skeptics|the counterargument|on the other hand|the case against|that said|to be fair|the other reading|bear case|bull case|doesn't prove|does not prove|cuts the other way|the objection|strongest objection|opposing case|opposing view|steelman)\b/i;

// A section that restates most of the planned counterargument engages it, whatever its
// heading is called.
function engagesCounterArgument(draft: DraftBlogArticleWriterOutput, counterArgument: string): boolean {
  const counterStems = contentStems(counterArgument);
  if (counterStems.length < 6) return false;
  return draft.sections.some((s) => sharedStemCount(contentStems(`${s.heading} ${s.body}`), counterStems) / counterStems.length >= 0.5);
}

const RESEARCH_METHOD_HEADING =
  /\b(where (?:these|the|this|our) (?:numbers?|figures?|data|evidence|statistics) comes? from|how (?:we|i) (?:know|researched|checked|sourced)|methodology|method(?:s)? and sources|about (?:the|these) (?:data|numbers|sources|figures)|(?:reading|checking) the (?:data|numbers|sources)|a note on (?:the )?(?:data|sources|numbers))\b/i;

export function hasResearchMethodSection(draft: DraftBlogArticleWriterOutput): boolean {
  return draft.sections.some(
    (s) => RESEARCH_METHOD_HEADING.test(s.heading) || s.body.split('\n').some((line) => line.startsWith('###') && RESEARCH_METHOD_HEADING.test(line)),
  );
}

// A cold open sets a scene (a moment, a place, a person or a hypothetical) rather than
// asserting a finding. Heuristic, so it only warns.
const SCENE_MARKER =
  /\b(picture|imagine|ask (?:a|an|any|your)|walk into|sit (?:in|at|down)|scroll|open (?:your|the)|on (?:a|an|the) (?:\w+ )?(?:morning|evening|afternoon|night|day|weekend)|one (?:morning|evening|afternoon|night|day)|(?:this|that|last) (?:week|month|morning|evening|diwali|summer|winter)|the (?:week|day|month|morning|evening|night) (?:a|an|the|your|after|before|when)|it is \d|it's \d|a \d{2}-year-old|the \d{2}-year-old|there is a moment|you are|you're (?:at|in|standing|sitting|holding|looking))\b/i;

export function opensWithScene(firstParagraph: string): boolean {
  const first = firstParagraph.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return SCENE_MARKER.test(first);
}

// Inline citations must point at claims the reader may be told as fact: citing an
// unknown or unverified claim means the sentence leans on evidence we don't have.
export function checkCitations(draft: DraftBlogArticleWriterOutput, usableClaimIds: ReadonlySet<string> | null): EditorialWarning[] {
  if (usableClaimIds === null) return [];
  const bodies = [...draft.sections.map((s) => s.body), draft.practicalTakeaway ?? '', draft.conclusion];
  const bad = [...new Set(bodies.flatMap(bodyCitedClaimIds))].filter((id) => !usableClaimIds.has(id));
  return bad.length > 0
    ? [{ code: 'unverified_citation', severity: 'block', message: `Inline citations point at claims that are unknown or not verified (${bad.join(', ')}): restate those sentences as attributed or uncertain, or cut them.` }]
    : [];
}

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
    const hasCounter =
      draft.sections.some((s) => COUNTER_HEADING.test(s.heading)) ||
      COUNTER_LANGUAGE.test(prose) ||
      (architecture.counterArgument !== null && engagesCounterArgument(draft, architecture.counterArgument));
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

  // The essay standard: deep pieces explain where their numbers come from, and open
  // on a scene rather than a thesis line.
  const isDeep = architecture !== null && (architecture.articleDepth === 'deep_analysis' || architecture.articleDepth === 'investigation');
  if (isDeep && !hasResearchMethodSection(draft)) {
    warnings.push({
      code: 'missing_research_method',
      severity: 'block',
      message: 'There is no "Where these numbers come from" section: add one (an H2, or an H3 in the first or second body section) naming the main sources, what each measures, its period and sample, who paid, and its limits.',
    });
  }
  const firstParagraph = plainBody(draft.sections[0]?.body ?? '').split(/\n{2,}/)[0] ?? '';
  if (isDeep && !opensWithScene(firstParagraph)) {
    warnings.push({
      code: 'opening_not_scene',
      severity: 'warn',
      message: 'The article opens with a statement, not a scene: start with a concrete moment that holds the problem in miniature, and move the thesis to the turn paragraph.',
    });
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
