import type { EditorialArchitecture, EditorialQuality, EditorialWarning, InternalLink, QaDimensionResult } from '@bb/shared-types';
import { EDITORIAL_HARD_THRESHOLDS } from '@bb/shared-types';

import type { DraftBlogArticleWriterOutput } from '../draftArticle.js';

// Spec 50: the Blog-specific half of the final quality gate (A-O). Fact, source,
// temporal, number and meaning-drift checks (A-F) already run in the shared QA gate's
// editorial dimensions; these add brand/AI-slop (G-H), originality and structure
// (I-J), interactive components (K), HTML (L), SEO (M), internal links (N) and reader
// value (O). Any FAIL makes the whole QA result BLOCKED: not publish-ready.

const pass = (notes: string): QaDimensionResult => ({ status: 'PASS', notes });
const warn = (notes: string, evidence: string[] = []): QaDimensionResult =>
  evidence.length > 0 ? { status: 'WARN', notes, evidence } : { status: 'WARN', notes };
const fail = (notes: string, evidence: string[] = []): QaDimensionResult =>
  evidence.length > 0 ? { status: 'FAIL', notes, evidence } : { status: 'FAIL', notes };

function byPrefix(warnings: readonly EditorialWarning[], prefix: string | RegExp): EditorialWarning[] {
  return warnings.filter((w) => (typeof prefix === 'string' ? w.code.startsWith(prefix) : prefix.test(w.code)));
}

function dimensionFrom(warnings: readonly EditorialWarning[], okNote: string): QaDimensionResult {
  const blocks = warnings.filter((w) => w.severity === 'block');
  if (blocks.length > 0) return fail(blocks.map((w) => w.message).join(' '), blocks.map((w) => w.code));
  const warns = warnings.filter((w) => w.severity === 'warn');
  if (warns.length > 0) return warn(warns.map((w) => w.message).join(' '), warns.map((w) => w.code));
  return pass(okNote);
}

export interface BlogPlatformCheckInput {
  draft: DraftBlogArticleWriterOutput;
  architecture: EditorialArchitecture | null;
  quality: EditorialQuality | null;
  warnings: readonly EditorialWarning[];
  htmlIssues: readonly string[];
  internalLinks: readonly InternalLink[];
  requestedLinkCount: number;
  renderedComponents: readonly string[];
}

export function buildBlogPlatformChecks(input: BlogPlatformCheckInput): Record<string, QaDimensionResult> {
  const { quality } = input;
  const criticFailures = byPrefix(input.warnings, 'critic_threshold');
  const editorialCritic = quality
    ? criticFailures.length > 0
      ? fail(`Below the editorial bar after the final editor: ${criticFailures.map((w) => w.message).join(' ')}`)
      : pass(
          `Critic scores meet every hard threshold (${EDITORIAL_HARD_THRESHOLDS.map((t) => `${t.key.replace('Score', '')} ${quality[t.key]}`).join(', ')}).`,
        )
    : warn('Editorial critic did not run for this draft — review quality manually.');

  const seoWarnings: string[] = [];
  if (input.draft.metaDescription.length > 170) seoWarnings.push(`meta description ${input.draft.metaDescription.length} chars`);
  if (!input.draft.seo?.primaryKeyword) seoWarnings.push('no primary keyword identified');
  const seo = seoWarnings.length > 0 ? warn(`SEO: ${seoWarnings.join('; ')}.`) : pass('Title, meta description and keywords present without stuffing.');

  const droppedLinks = input.requestedLinkCount - input.internalLinks.length;
  const internalLinks =
    droppedLinks > 0
      ? warn(`${droppedLinks} suggested internal link(s) were dropped (unknown target or anchor not in the text).`)
      : pass(input.internalLinks.length > 0 ? `${input.internalLinks.length} internal link(s), each to a published article.` : 'No internal links forced.');

  const readerValue =
    quality && (quality.readerUtilityScore < 7 || quality.depthScore < 7)
      ? warn(`Reader value is thin (utility ${quality.readerUtilityScore}, depth ${quality.depthScore}).`)
      : pass(quality ? 'The article teaches something and answers "why should I care?".' : 'Not scored (critic unavailable).');

  return {
    editorial_critic: editorialCritic,
    ai_slop: dimensionFrom(byPrefix(input.warnings, 'slop.'), 'No generic AI phrasing or formulaic patterns detected.'),
    meaning_drift: dimensionFrom(byPrefix(input.warnings, 'drift.'), 'No drift from verified claims.'),
    structure: dimensionFrom(
      input.warnings.filter((w) => /^(too_|missing_counterargument|conclusion_repeats_intro|duplicate_headings|unapproved_components)/.test(w.code)),
      'Structure fits the planned depth; the counterargument is engaged; the ending adds something.',
    ),
    interactive_components: dimensionFrom(
      byPrefix(input.warnings, 'component_dropped'),
      input.renderedComponents.length > 0
        ? `Components (${input.renderedComponents.join(', ')}) approved by the decision engine and traced to verified claims.`
        : 'No components: none earned a place.',
    ),
    html: input.htmlIssues.length > 0 ? fail(input.htmlIssues.join(' ')) : pass('Deterministic HTML: escaped, accessible, mobile-safe, only the known script.'),
    seo,
    internal_links: internalLinks,
    reader_value: readerValue,
  };
}
