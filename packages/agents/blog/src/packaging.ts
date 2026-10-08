import type { BlogPackage, ClaimLedgerEntry, ContentItem, CoverageCheck, EditorialSummary, QaResult } from '@bb/shared-types';
import { BlogPackageSchema } from '@bb/shared-types';

import type { DraftBlogArticleOutput } from './draftArticle.js';

export interface BlogPackageExtras {
  claimLedger?: ClaimLedgerEntry[];
  coverage?: CoverageCheck | null;
  interactiveComponents?: string[];
}

export function buildBlogPackage(
  item: ContentItem,
  draft: DraftBlogArticleOutput,
  slug: string,
  qa: QaResult,
  editorialSummary: EditorialSummary | null = null,
  extras: BlogPackageExtras = {},
): BlogPackage {
  const title = draft.titleOptions[0];
  if (!title) throw new Error('buildBlogPackage: draft has no title options');

  const ledger = extras.claimLedger ?? [];
  const usableCount = ledger.filter((c) => c.allowedUse === 'state_as_fact' || c.allowedUse === 'attribute').length;
  const factCheckStatus =
    ledger.length > 0
      ? `${usableCount} of ${ledger.length} research claims verified; every factual statement maps to the claim ledger. QA: ${qa.overallStatus}.`
      : draft.sources.length > 0
        ? 'Sourced where cited; see sources.'
        : 'Opinion/analysis, no external sources.';

  return BlogPackageSchema.parse({
    contentId: item.id,
    status: item.status,
    title,
    slug,
    category: draft.category,
    metaDescription: draft.metaDescription,
    deck: draft.deck,
    estimatedReadTime: draft.estimatedReadTime,
    sources: draft.sources,
    articleSummary: draft.articleSummary,
    htmlFile: item.currentText,
    qaStatus: qa.overallStatus,
    factCheckStatus,
    seoStatus: draft.seoStatus,
    styleMatchStatus: draft.styleMatchStatus,
    contentDnaVersion: item.contentDnaVersion,
    approvalRequired: true,
    publishAction: 'none',
    editorialSummary,
    editorialArchitecture: draft.editorialArchitecture,
    editorialQuality: draft.editorialQuality,
    interactiveComponents: extras.interactiveComponents ?? [],
    claimLedger: ledger,
    internalLinks: draft.internalLinks,
    seo: draft.seo,
    coverage: extras.coverage ?? null,
    editorialWarnings: draft.editorialWarnings,
  });
}
