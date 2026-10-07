import type { LlmClient, Logger } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import type { ProvidedDocument } from '@bb/editorial-intelligence';
import {
  briefSourceReferences,
  briefSourceTexts,
  buildEditorialSummary,
  draftWithMeaningGuard,
  loadSiblingDrafts,
  prepareEditorialBrief,
  tierForUrl,
} from '@bb/editorial-intelligence';
import type { FetchTool } from '@bb/mcp-client';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { BlogPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';

import type { DraftBlogArticleOutput } from './draftArticle.js';
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
  // Research runs through the agent's scoped fetch MCP tool (spec 33).
  fetchTool: FetchTool;
  logger: Logger;
  topic: string;
  // The user's original chat message, when there is one (spec 34/35).
  userMessage?: string | null;
  // Spec 12.2's blog modes (new article, research-first, explainer, comparison/
  // review, how-to guide, news/context, evergreen SEO, update/rewrite, source-led) —
  // a framing label for the drafting prompt, not a distinct workflow per mode.
  articleType: string;
  constraints?: string | null;
  // Source-led articles: the supplied source(s), parallel arrays. They become the lead
  // research documents of the editorial brief — verified like any other evidence.
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
  const suppliedTexts = input.sourceTexts ?? [];
  const suppliedReferences = input.sourceReferences ?? [];
  const providedDocuments: ProvidedDocument[] = suppliedTexts.map((text, i) => {
    const reference = suppliedReferences[i] ?? null;
    const isUrl = reference !== null && /^https?:\/\//i.test(reference);
    return {
      kind: isUrl ? 'fetched_article' : 'user_text',
      text,
      url: isUrl ? reference : null,
      title: isUrl ? null : reference,
      publisher: null,
      tier: isUrl && reference ? tierForUrl(reference) : 'discovery',
    };
  });

  // Topic (+ any supplied source) -> research -> verified EditorialBrief, before drafting.
  const brief = await prepareEditorialBrief(
    { pool: input.pool, llm: input.llm, fetchTool: input.fetchTool, logger: input.logger },
    {
      topic: input.topic,
      userMessage: input.userMessage ?? null,
      contentDna: dna,
      runId: input.runId,
      providedDocuments,
    },
  );
  const sourceReferences = [...new Set([...suppliedReferences, ...briefSourceReferences(brief)])];
  const sourceTexts = [...suppliedTexts, ...briefSourceTexts(brief)];

  const flatten = (d: DraftBlogArticleOutput): string =>
    [d.titleOptions[0] ?? '', d.deck, d.thesis, ...d.sections.map((sec) => `${sec.heading}\n${sec.body}`), d.practicalTakeaway ?? '', d.conclusion]
      .filter((t) => t.length > 0)
      .join('\n\n');

  const { draft } = await draftWithMeaningGuard({
    brief,
    draft: (revisionNotes) =>
      draftBlogArticle({
        topic: input.topic,
        articleType: input.articleType,
        constraints: input.constraints ?? null,
        sourceTexts: [],
        ...(input.sampleArticleTexts !== undefined ? { sampleArticleTexts: input.sampleArticleTexts } : {}),
        contentDna: dna,
        llm: input.llm,
        runId: input.runId,
        stepId: 'draft-blog-article',
        editorialBrief: brief,
        revisionNotes,
      }),
    textOf: flatten,
    logger: input.logger,
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
    metaDescription: draft.metaDescription,
    sections: draft.sections,
    practicalTakeaway: draft.practicalTakeaway,
    conclusion: draft.conclusion,
    disclaimer: draft.disclaimer,
    sources: draft.sources,
    comparisonStat: draft.comparisonStat,
    revealCards: draft.revealCards,
    poll: draft.poll,
    pullQuote: draft.pullQuote,
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
    riskLevel: brief.riskLevel,
    package: { ...draft, slug, editorialBrief: brief },
  });

  // QA judges the article's actual prose, not markup noise — flatten the structured
  // draft back to plain text rather than feeding it the assembled HTML.
  const plainText = flatten(draft);

  // A QA gate failure (e.g. every LLM provider down at once — observed live,
  // 2026-09-15) must not strand this item in "draft" forever: createContentItem
  // above already persisted it, and submitForReview below is the only thing that
  // gets it into a human's review queue at all. Falling back to an honest
  // "QA didn't run" BLOCKED result (never a fabricated PASS) keeps that path open.
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
    editorial: {
      brief,
      siblingDrafts: await loadSiblingDrafts(input.pool, brief.id, item.id),
      opening: [title, draft.deck].join('. '),
    },
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);
  return buildBlogPackage(reviewedItem, draft, slug, qa, buildEditorialSummary(brief));
}
