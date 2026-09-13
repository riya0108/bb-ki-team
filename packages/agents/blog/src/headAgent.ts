import type { LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import { runQaGate } from '@bb/qa-gate';
import type { BlogPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';

import { draftBlogArticle } from './draftArticle.js';
import { InvalidArticleHtmlError } from './errors.js';
import { buildArticleHtml, slugify } from './htmlBuilder.js';
import { validateBlogHtml } from './htmlValidation.js';
import { buildBlogPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-05-blog';
const QA_PLATFORM_LABEL = 'Blog article';

export interface RunBlogArticleInput {
  pool: Pool;
  llm: LlmClient;
  topic: string;
  // Spec 12.2's blog modes (new article, research-first, explainer, comparison/
  // review, how-to guide, news/context, evergreen SEO, update/rewrite, source-led) —
  // a framing label for the drafting prompt, not a distinct workflow per mode.
  articleType: string;
  constraints?: string | null;
  sourceTexts?: string[];
  sourceReferences?: string[];
  sampleArticleTexts?: string[];
  runId: string;
}

// Spec 12.3's Blog workflow: draft in structured form, assemble HTML deterministically
// (see htmlBuilder.ts), validate it, run the QA gate against the plain-text content,
// persist, and submit for review. Never publishes or schedules — Phase 3's connectors
// are separate and explicitly gated on a recorded approval.
export async function runBlogArticle(input: RunBlogArticleInput): Promise<BlogPackage> {
  const dna = await loadCurrentDna(input.pool);
  const sourceTexts = input.sourceTexts ?? [];
  const sourceReferences = input.sourceReferences ?? [];

  const draft = await draftBlogArticle({
    topic: input.topic,
    articleType: input.articleType,
    constraints: input.constraints ?? null,
    sourceTexts,
    ...(input.sampleArticleTexts !== undefined ? { sampleArticleTexts: input.sampleArticleTexts } : {}),
    contentDna: dna,
    llm: input.llm,
    runId: input.runId,
    stepId: 'draft-blog-article',
  });

  const title = draft.titleOptions[0];
  if (!title) throw new Error('runBlogArticle: draft returned no title options');
  const slug = slugify(title);

  const { html } = buildArticleHtml({
    title,
    deck: draft.deck,
    category: draft.category,
    sections: draft.sections,
    practicalTakeaway: draft.practicalTakeaway,
    conclusion: draft.conclusion,
    disclaimer: draft.disclaimer,
    sources: draft.sources,
  });

  const validation = validateBlogHtml(html);
  if (!validation.valid) throw new InvalidArticleHtmlError(validation.issues);

  const item = await createContentItem(input.pool, {
    platform: 'blog',
    createdByAgent: CREATED_BY_AGENT,
    mode: 'single_topic',
    topic: input.topic,
    contentPillar: draft.category,
    sourceUrls: sourceReferences,
    contentDnaVersion: dna.version,
    text: html,
    riskLevel: 'low',
    package: { ...draft, slug },
  });

  // QA judges the article's actual prose, not markup noise — flatten the structured
  // draft back to plain text rather than feeding it the assembled HTML.
  const plainText = [
    draft.thesis,
    ...draft.sections.map((s) => `${s.heading}\n${s.body}`),
    draft.practicalTakeaway ?? '',
    draft.conclusion,
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');

  const qa = await runQaGate({
    finalPost: plainText,
    sourceReferences,
    sourceTexts,
    contentDna: dna,
    status: item.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${item.id}`,
    platform: QA_PLATFORM_LABEL,
  });
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);
  return buildBlogPackage(reviewedItem, draft, slug, qa);
}
