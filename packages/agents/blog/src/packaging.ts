import type { BlogPackage, ContentItem, EditorialSummary, QaResult } from '@bb/shared-types';
import { BlogPackageSchema } from '@bb/shared-types';

import type { DraftBlogArticleOutput } from './draftArticle.js';

export function buildBlogPackage(
  item: ContentItem,
  draft: DraftBlogArticleOutput,
  slug: string,
  qa: QaResult,
  editorialSummary: EditorialSummary | null = null,
): BlogPackage {
  const title = draft.titleOptions[0];
  if (!title) throw new Error('buildBlogPackage: draft has no title options');

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
    factCheckStatus:
      draft.sources.length > 0 ? 'Sourced where cited; see sources.' : 'Opinion/analysis, no external sources.',
    seoStatus: draft.seoStatus,
    styleMatchStatus: draft.styleMatchStatus,
    contentDnaVersion: item.contentDnaVersion,
    approvalRequired: true,
    publishAction: 'none',
    editorialSummary,
  });
}
