import type { LlmClient, Logger } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import type { ContextBudget, DiscoveryResearcher, ProvidedDocument } from '@bb/editorial-intelligence';
import {
  briefSourceReferences,
  briefSourceTexts,
  buildClaimLedger,
  buildEditorialSummary,
  buildSourceDisplay,
  loadSiblingDrafts,
  prepareEditorialBrief,
  TIER_RANK,
  tierForUrl,
} from '@bb/editorial-intelligence';
import type { FetchTool } from '@bb/mcp-client';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { BlogPackage, EditorialBrief, EditorialWarning } from '@bb/shared-types';
import { isUsableClaim } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';

import { bodyCitedClaimIds, bodyPlainText } from './bodyMarkup.js';
import type { DraftBlogArticleOutput, DraftBlogArticleWriterOutput } from './draftArticle.js';
import { draftBlogArticle } from './draftArticle.js';
import { planArticle } from './editorial/architect.js';
import { articlePlainText } from './editorial/articleText.js';
import { loadCoverageContext, renderCoverageForPlanner, resolveInternalLinks } from './editorial/coverage.js';
import { buildBlogPlatformChecks } from './editorial/platformChecks.js';
import { loadBlogStyleProfile, renderStyleProfileForWriter } from './editorial/styleProfile.js';
import { writeArticleWithEditorialLoop } from './editorial/writeArticle.js';
import { InvalidArticleHtmlError } from './errors.js';
import { buildArticleHtml, slugify } from './htmlBuilder.js';
import { validateBlogHtml } from './htmlValidation.js';
import { loadEditorialMemories, markMemoriesUsed, renderMemoriesForWriter } from './memory/editorialMemory.js';
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
  // How many final-editor revisions the editorial loop may run (default 1).
  maxRevisions?: number;
  // Agentic web research (Claude Code) feeding the brief's deep research; its leads
  // are re-fetched through fetchTool and verified like any other source.
  discoveryResearcher?: DiscoveryResearcher | undefined;
  // 'large' when llm is a long-context model: research reads far more per source.
  contextBudget?: ContextBudget | undefined;
}

// Spec 12.3's Blog workflow, upgraded to the editorial pipeline:
//   topic -> deep research -> verified claims -> story essence/angle (EditorialBrief)
//   -> prior coverage + style profile + editorial memory -> article architecture
//   -> first draft -> deterministic checks + editorial critic -> final editor
//   -> deterministic HTML -> validation -> QA gate -> human review.
// Never publishes or schedules — Phase 3's connectors are separate and explicitly
// gated on a recorded approval.
// The Claude Code research options, bundled so callers (API routes, chat, repurpose)
// pass them through unchanged.
export interface BlogResearchOptions {
  discoveryResearcher?: DiscoveryResearcher | undefined;
  contextBudget?: ContextBudget | undefined;
}

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

  // Topic (+ any supplied source) -> deep research (incl. counter-evidence) -> verified
  // EditorialBrief, before anything is planned or written.
  const brief = await prepareEditorialBrief(
    {
      pool: input.pool,
      llm: input.llm,
      fetchTool: input.fetchTool,
      logger: input.logger,
      discoveryResearcher: input.discoveryResearcher,
      contextBudget: input.contextBudget,
    },
    {
      topic: input.topic,
      userMessage: input.userMessage ?? null,
      contentDna: dna,
      runId: input.runId,
      providedDocuments,
      researchProfile: 'deep',
    },
  );
  const sourceReferences = [...new Set([...suppliedReferences, ...briefSourceReferences(brief)])];
  const sourceTexts = [...suppliedTexts, ...briefSourceTexts(brief)];

  // What Bull or Bear has already written, how it writes, and what its editor has taught it.
  const [memories, styleProfile, coverageContext] = await Promise.all([
    loadEditorialMemories(input.pool),
    loadBlogStyleProfile(input.pool),
    loadCoverageContext(input.pool, input.topic, brief.topicKey),
  ]);
  const styleGuidance = [renderStyleProfileForWriter(styleProfile), renderMemoriesForWriter(memories)].filter((b) => b.length > 0).join('\n\n');

  const architecture = await planArticle({
    topic: input.topic,
    articleType: input.articleType,
    constraints: input.constraints ?? null,
    brief,
    styleGuidance,
    coverageNote: renderCoverageForPlanner(coverageContext.coverage),
    memories,
    llm: input.llm,
    logger: input.logger,
    runId: input.runId,
  });
  input.logger.info(
    {
      runId: input.runId,
      stepId: 'blog-architect',
      depth: architecture.articleDepth,
      source: architecture.source,
      components: architecture.componentDecisions.filter((d) => d.decision === 'USE').map((d) => d.type),
    },
    'Article architecture ready',
  );

  const written = await writeArticleWithEditorialLoop({
    write: (revisionNotes, previousDraft) =>
      draftBlogArticle({
        topic: input.topic,
        articleType: input.articleType,
        constraints: input.constraints ?? null,
        sourceTexts: [],
        ...(input.sampleArticleTexts !== undefined ? { sampleArticleTexts: input.sampleArticleTexts } : {}),
        contentDna: dna,
        llm: input.llm,
        runId: input.runId,
        stepId: previousDraft ? 'blog-final-editor' : 'draft-blog-article',
        editorialBrief: brief,
        revisionNotes,
        architecture,
        styleGuidance,
        internalLinkCandidates: coverageContext.linkCandidates,
        previousDraft,
      }),
    brief,
    architecture,
    llm: input.llm,
    logger: input.logger,
    runId: input.runId,
    ...(input.maxRevisions !== undefined ? { maxRevisions: input.maxRevisions } : {}),
  });
  await markMemoriesUsed(input.pool, memories).catch(() => undefined);

  const coverageWarnings: EditorialWarning[] =
    coverageContext.coverage.status === 'previously_covered'
      ? [
          {
            code: 'prior_coverage',
            severity: 'warn',
            message: `Bull or Bear has covered this before ("${coverageContext.coverage.matches[0]?.title ?? ''}"); planner decision: ${architecture.priorCoverageDecision.replace(/_/g, ' ')}.`,
          },
        ]
      : [];

  const assembled = assembleBlogArticle({
    draft: written.draft,
    brief,
    linkCandidates: coverageContext.linkCandidates,
  });

  const stored: DraftBlogArticleOutput = {
    ...assembled.draft,
    editorialArchitecture: architecture,
    editorialQuality: written.quality,
    styleMemorySignals: [],
    editorialWarnings: [...written.warnings, ...coverageWarnings],
  };

  const item = await createContentItem(input.pool, {
    platform: 'blog',
    createdByAgent: CREATED_BY_AGENT,
    mode: 'single_topic',
    topic: input.topic,
    contentPillar: stored.category,
    sourceUrls: sourceReferences,
    contentDnaVersion: dna.version,
    text: assembled.html,
    riskLevel: brief.riskLevel,
    package: { ...stored, slug: assembled.slug, editorialBrief: brief, coverage: coverageContext.coverage },
  });

  // QA judges the article's actual words — prose AND every widget's text — not markup.
  const plainText = articlePlainText(stored);

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
      opening: [assembled.title, stored.deck].join('. '),
    },
    platformChecks: buildBlogPlatformChecks({
      draft: stored,
      architecture,
      quality: written.quality,
      warnings: stored.editorialWarnings,
      htmlIssues: [],
      internalLinks: stored.internalLinks,
      requestedLinkCount: written.draft.internalLinks.length,
      renderedComponents: assembled.components,
    }),
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);
  return buildBlogPackage(reviewedItem, stored, assembled.slug, qa, buildEditorialSummary(brief), {
    claimLedger: brief.kind === 'opinion' ? [] : buildClaimLedger(brief),
    coverage: coverageContext.coverage,
    interactiveComponents: assembled.components,
  });
}

export interface AssembleBlogArticleInput {
  draft: DraftBlogArticleWriterOutput;
  brief: EditorialBrief | null;
  linkCandidates: readonly { contentId: string; title: string; url: string; thesis: string | null }[];
  now?: Date;
}

// Inline citations resolve a usable claim to the best fetched source that actually
// contains its evidence (quote found, highest tier, never discovery-only). A claim
// with no such source gets no link — the sentence still reads, it just isn't linked.
export function citationTargets(brief: EditorialBrief | null): Record<string, string> {
  if (!brief || brief.kind === 'opinion') return {};
  const sourcesById = new Map(brief.sources.map((s) => [s.id, s]));
  const out: Record<string, string> = {};
  for (const claim of brief.claims.filter(isUsableClaim)) {
    const best = claim.evidence
      .filter((e) => e.quoteFound)
      .map((e) => sourcesById.get(e.sourceId))
      .filter((s): s is NonNullable<typeof s> => s !== undefined && s.url !== null && s.tier !== 'discovery')
      .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])[0];
    if (best?.url) out[claim.id] = best.url;
  }
  return out;
}

const MAX_SECTION_SOURCES = 3;

export function sectionSourceNote(
  section: { body: string; claimIds: readonly string[] },
  sourceDisplay: readonly { shortLabel: string; claimIds: readonly string[] }[],
): string | null {
  const cited = new Set([...section.claimIds, ...bodyCitedClaimIds(section.body)]);
  if (cited.size === 0) return null;
  const labels = [
    ...new Set(sourceDisplay.filter((s) => s.claimIds.some((id) => cited.has(id))).map((s) => s.shortLabel)),
  ].slice(0, MAX_SECTION_SOURCES);
  return labels.length > 0 ? `Source: ${labels.join('; ')}` : null;
}

const WORDS_PER_MINUTE = 230;

function readTimeOf(draft: DraftBlogArticleWriterOutput): string {
  const words = [...draft.sections.map((s) => bodyPlainText(s.body)), bodyPlainText(draft.practicalTakeaway ?? ''), bodyPlainText(draft.conclusion)]
    .join(' ')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  return `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min`;
}

export interface AssembledBlogArticle {
  // The writer draft with its internal links resolved and its sources replaced by
  // the verified source display (writer-supplied source labels are never trusted when
  // a researched brief exists — spec 27: no invented citations).
  draft: Omit<DraftBlogArticleOutput, 'editorialArchitecture' | 'editorialQuality' | 'styleMemorySignals' | 'editorialWarnings'>;
  title: string;
  slug: string;
  html: string;
  components: string[];
}

// Draft -> deterministic HTML -> validation. Shared by new drafts and edits so an edit
// can never produce markup the validator hasn't checked.
export function assembleBlogArticle(input: AssembleBlogArticleInput): AssembledBlogArticle {
  const { draft, brief } = input;
  const title = draft.titleOptions[0];
  if (!title) throw new Error('assembleBlogArticle: draft returned no title options');
  const slug = slugify(title);

  const bodyText = [...draft.sections.map((s) => bodyPlainText(s.body)), bodyPlainText(draft.practicalTakeaway ?? ''), bodyPlainText(draft.conclusion)].join('\n\n');
  const internalLinks = resolveInternalLinks(draft.internalLinks, input.linkCandidates, bodyText).map((l) => ({
    ...l,
    targetSlug: l.targetSlug || (l.targetUrl.split('/').filter((p) => p.length > 0).pop() ?? ''),
  }));

  const sourceDisplay = brief && brief.kind !== 'opinion' ? buildSourceDisplay(brief) : [];
  const sourceLinks = sourceDisplay.map((s) => ({ label: s.label, url: s.url }));
  // With a researched brief, a section's "Source:" line names the outlets whose fetched
  // text backs the claims that section cites — never a writer-typed label, which can
  // name a report we never read and that the sources list then doesn't contain.
  const sections =
    brief && brief.kind !== 'opinion'
      ? draft.sections.map((section) => ({ ...section, sourceNote: sectionSourceNote(section, sourceDisplay) }))
      : draft.sections;
  const sources = sourceLinks.length > 0 ? sourceLinks.map((s) => s.label) : brief && brief.kind !== 'opinion' ? [] : draft.sources;

  const { html, components } = buildArticleHtml({
    title,
    deck: draft.deck,
    category: draft.category,
    metaDescription: draft.metaDescription,
    sections,
    practicalTakeaway: draft.practicalTakeaway,
    conclusion: draft.conclusion,
    disclaimer: draft.disclaimer,
    sources,
    sourceLinks,
    shortVersion: draft.shortVersion,
    comparisonStat: draft.comparisonStat,
    revealCards: draft.revealCards,
    poll: draft.poll,
    pullQuote: draft.pullQuote,
    table: draft.table,
    quiz: draft.quiz,
    decision: draft.decision,
    timeline: draft.timeline,
    barChart: draft.barChart,
    faq: draft.faq,
    conclusionHeading: draft.conclusionHeading,
    strapline: draft.strapline,
    titleAccent: draft.titleAccent,
    readTime: readTimeOf(draft),
    dateLabel: (input.now ?? new Date()).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    citations: citationTargets(brief),
    internalLinks: internalLinks.map((l) => ({ anchorText: l.anchorText, url: l.targetUrl })),
  });

  const validation = validateBlogHtml(html);
  if (!validation.valid) throw new InvalidArticleHtmlError(validation.issues);

  return { draft: { ...draft, sections, sources, internalLinks }, title, slug, html, components };
}
