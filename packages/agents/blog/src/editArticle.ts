import type { LlmClient, Logger } from '@bb/core';
import { BRAND_BRAIN, createLogger } from '@bb/core';
import { classifyEditInstruction, classifyLearningSignal, loadCurrentDna, recordLearningEvent } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import {
  briefSourceTexts,
  buildClaimLedger,
  buildEditorialSummary,
  editorialBriefFromPackage,
  loadSiblingDrafts,
  renderProtectedFactsForEditor,
} from '@bb/editorial-intelligence';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { BlogPackage, ContentDnaRecord, CoverageCheck, EditorialBrief, LearningEvent } from '@bb/shared-types';
import { CoverageCheckSchema } from '@bb/shared-types';
import { ContentItemNotFoundError, addRevision, getContentItem, recordQaResult } from '@bb/workflows';

import { BLOG_CRAFT_RULES, DraftBlogArticleOutputSchema, DraftBlogArticleWriterSchema } from './draftArticle.js';
import type { DraftBlogArticleOutput, DraftBlogArticleWriterOutput } from './draftArticle.js';
import { articlePlainText } from './editorial/articleText.js';
import { critiqueArticle } from './editorial/critic.js';
import { buildBlogPlatformChecks } from './editorial/platformChecks.js';
import { enforceAllowedComponents, runDraftChecks } from './editorial/writeArticle.js';
import { assembleBlogArticle } from './headAgent.js';
import { parseFeedbackDeterministically } from './memory/feedback.js';
import { recordEditorialSignal } from './memory/editorialMemory.js';
import { buildBlogPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-05-blog';

function buildReviseSystemPrompt(dna: ContentDnaRecord, brief: EditorialBrief | null): string {
  return `You are Agent 05 — the Bull or Bear Blog HTML Agent (spec section 12), in Edit mode: the
human has asked for a change to an already-drafted article (a rewritten section, a formatting/
structure tweak, a tone adjustment, a trim, an added or removed component) rather than a brand new
article.

Brand voice principles:
${BRAND_BRAIN.voice.principles.map((p) => `- ${p}`).join('\n')}
Permanent writing rules:
${BRAND_BRAIN.permanentWritingRules.map((r) => `- ${r}`).join('\n')}
Editorial craft:
${BLOG_CRAFT_RULES.map((r) => `- ${r}`).join('\n')}

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

Revise the article per the instruction below. Only change what the instruction asks for (a single
section, the title, a component, formatting, tone, length, etc.) — preserve every other field
exactly as given unless the edit necessarily touches it. Do not invent new facts, sources, numbers
or quotes while revising; do not change the underlying claims unless explicitly asked to.

Optional components (comparisonStat, revealCards, poll, pullQuote, table, quiz, decision, timeline)
work the same as at drafting time — keep, drop, or add one only if it genuinely fits, never to
decorate, and every factual cell/answer must come from the verified claims. Each one's
afterSectionIndex is a 0-based index into the (possibly now-different) "sections" array. All text is
plain text, never HTML.${renderProtectedFactsForEditor(brief)}`;
}

function writerFields(draft: DraftBlogArticleOutput): DraftBlogArticleWriterOutput {
  return DraftBlogArticleWriterSchema.parse({
    ...draft,
    internalLinks: draft.internalLinks.map((l) => ({ anchorText: l.anchorText, targetContentId: l.targetContentId, reason: l.reason })),
  });
}

function buildReviseUserPrompt(current: DraftBlogArticleWriterOutput, instruction: string): string {
  return `Current article (JSON):
${JSON.stringify(current, null, 2)}

Edit instruction: ${instruction}

Return the FULL revised article using the same JSON shape — every field, not just the ones that
changed.`;
}

export interface ReviseBlogArticleInput {
  pool: Pool;
  llm: LlmClient;
  contentId: string;
  instruction: string;
  runId: string;
  logger?: Logger;
}

export interface ReviseBlogArticleResult {
  package: BlogPackage;
  // Non-null only when the instruction reads as a general voice/style preference
  // rather than a one-off content tweak (spec 16: the Learning Loop) — mirrors
  // reviseLinkedinPost's same signal detection so the Learning Events panel behaves
  // consistently across platforms.
  learningEvent: LearningEvent | null;
}

// Mirrors packages/agents/linkedin/src/editPost.ts's reviseLinkedinPost: every edit is
// its own revision (addRevision bumps the version and, per spec 15.2, invalidates/
// resubmits an approved item for review), gets a fresh QA pass, and is checked for a
// voice-level learning signal. The structured draft (stored in content_items.package
// since blog creation, see headAgent.ts) — not the rendered HTML — is what actually
// gets edited; the HTML is deterministically rebuilt from it via assembleBlogArticle
// the same way a brand-new draft is, so an edit can never produce markup the validator
// hasn't already checked at creation time.
export async function reviseBlogArticle(input: ReviseBlogArticleInput): Promise<ReviseBlogArticleResult> {
  const item = await getContentItem(input.pool, input.contentId);
  if (!item) throw new ContentItemNotFoundError(input.contentId);

  const storedPackage = item.package ?? {};
  const slug = typeof storedPackage.slug === 'string' ? storedPackage.slug : '';
  if (!slug) throw new Error(`Blog content item ${item.id} has no stored slug to edit against`);
  const currentDraft = DraftBlogArticleOutputSchema.parse(storedPackage);
  // Carried into the revised package so every edit stays held to the same verified claims.
  const brief = editorialBriefFromPackage(storedPackage);
  const coverageParse = CoverageCheckSchema.safeParse(storedPackage.coverage);
  const coverage: CoverageCheck | null = coverageParse.success ? coverageParse.data : null;
  const architecture = currentDraft.editorialArchitecture;

  const dna = await loadCurrentDna(input.pool);

  const revisedRaw = await input.llm.completeStructured(
    {
      system: buildReviseSystemPrompt(dna, brief),
      messages: [{ role: 'user', content: buildReviseUserPrompt(writerFields(currentDraft), input.instruction) }],
      runId: input.runId,
      stepId: `revise-${item.id}`,
      maxTokens: 8000,
    },
    DraftBlogArticleWriterSchema,
  );
  // A human explicitly asking for a component overrides the planner's original decision
  // for this article; otherwise unapproved components stay out.
  const asksForComponent = /\b(add|include|insert|put)\b[^.]*\b(table|quiz|poll|timeline|flip cards?|reveal cards?|decision|choose an option|pull quote|stat)\b/i.test(input.instruction);
  const revised = asksForComponent ? revisedRaw : enforceAllowedComponents(revisedRaw, architecture);

  // Link targets were offered at drafting time; edits may keep or drop them, never add new targets.
  const linkCandidates = currentDraft.internalLinks.map((l) => ({ contentId: l.targetContentId, title: l.targetTitle, url: l.targetUrl, thesis: null }));
  const assembled = assembleBlogArticle({ draft: revised, brief, linkCandidates });

  const checks = runDraftChecks(revised, brief, architecture);
  const critic = await critiqueArticle({
    articleText: articlePlainText(revised),
    architecture,
    brief,
    findings: {
      slopRisk: checks.slop.riskScore,
      slopNotes: checks.slop.findings.map((f) => f.message),
      driftIssues: checks.drift.length,
      componentEvidenceIssues: checks.componentIssues.length,
      structureBlocks: checks.structure.filter((w) => w.severity === 'block').map((w) => w.message),
    },
    llm: input.llm,
    logger: input.logger ?? createLogger({ module: CREATED_BY_AGENT }),
    runId: input.runId,
    stepId: `blog-critic-edit-${item.id}`,
  });
  const warnings = [
    ...checks.slop.findings.map((f) => ({ code: `slop.${f.code}`, severity: f.severity, message: f.message })),
    ...checks.drift.map((d) => ({ code: `drift.${d.rule}`, severity: 'block' as const, message: d.explanation })),
    ...checks.componentIssues.map((i) => ({ code: 'component_evidence', severity: 'block' as const, message: `The ${i.component} ${i.detail}.` })),
    ...checks.structure,
    ...(critic === null ? [{ code: 'critic_unavailable', severity: 'warn' as const, message: 'The editorial critic could not run for this edit.' }] : []),
    ...(critic?.failures ?? []).map((f) => ({ code: 'critic_threshold', severity: 'block' as const, message: `Editorial quality below the bar: ${f}.` })),
  ];

  const stored: DraftBlogArticleOutput = {
    ...assembled.draft,
    editorialArchitecture: architecture,
    editorialQuality: critic?.quality ?? null,
    styleMemorySignals: [],
    editorialWarnings: warnings,
  };

  const { item: revisedItem } = await addRevision(input.pool, input.contentId, {
    changeType: 'ai_regeneration',
    newText: assembled.html,
    changedBy: 'agent',
    changedById: CREATED_BY_AGENT,
    reason: input.instruction,
    package: { ...stored, slug, ...(brief ? { editorialBrief: brief } : {}), ...(coverage ? { coverage } : {}) },
  });

  // Same reasoning as headAgent.ts's runBlogArticle: addRevision above already
  // persisted the edit, so a QA (or, below, edit-instruction-classification)
  // provider outage must not throw the result away and leave the human thinking
  // their edit silently failed when it actually landed.
  const qa = await runQaGate({
    finalPost: articlePlainText(stored),
    sourceReferences: revisedItem.sourceUrls,
    sourceTexts: brief ? briefSourceTexts(brief) : [],
    contentDna: dna,
    status: revisedItem.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${revisedItem.id}-v${revisedItem.currentVersion}`,
    platform: 'Blog article',
    ...(brief
      ? {
          editorial: {
            brief,
            siblingDrafts: await loadSiblingDrafts(input.pool, brief.id, revisedItem.id),
            opening: [assembled.title, stored.deck].join('. '),
          },
        }
      : {}),
    platformChecks: buildBlogPlatformChecks({
      draft: stored,
      architecture,
      quality: stored.editorialQuality,
      warnings,
      htmlIssues: [],
      internalLinks: stored.internalLinks,
      requestedLinkCount: revised.internalLinks.length,
      renderedComponents: assembled.components,
    }),
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, revisedItem.id, revisedItem.currentVersion, qa);

  // An edit instruction about one article is a one-off signal: recorded as observed
  // (INFERRED) editorial memory, confirmed only if it keeps recurring (spec 9).
  for (const signal of parseFeedbackDeterministically(input.instruction)) {
    await recordEditorialSignal(input.pool, {
      subject: signal.subject,
      polarity: signal.polarity,
      source: 'revision_instruction',
      strength: 'observed',
      contentId: revisedItem.id,
    }).catch(() => undefined);
  }

  // Best-effort: a failure here only costs the Learning Loop's voice-signal
  // detection for this one edit, never the edit itself.
  const classification = await classifyEditInstruction(input.instruction, dna, input.llm, input.runId).catch(
    () => ({ isVoiceLevelInstruction: false as const, summary: '', proposedChange: null }),
  );
  let learningEvent: LearningEvent | null = null;
  if (classification.isVoiceLevelInstruction) {
    learningEvent = await recordLearningEvent(input.pool, {
      contentId: revisedItem.id,
      source: 'user_instruction',
      observation: classification.summary,
      strength: classifyLearningSignal({ kind: 'explicit_instruction', text: input.instruction }),
      proposedChange: classification.proposedChange,
    });
  }

  return {
    package: buildBlogPackage(revisedItem, stored, slug, qa, brief ? buildEditorialSummary(brief) : null, {
      claimLedger: brief && brief.kind !== 'opinion' ? buildClaimLedger(brief) : [],
      coverage,
      interactiveComponents: assembled.components,
    }),
    learningEvent,
  };
}
