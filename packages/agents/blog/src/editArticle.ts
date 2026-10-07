import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import { classifyEditInstruction, classifyLearningSignal, loadCurrentDna, recordLearningEvent } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import {
  briefSourceTexts,
  buildEditorialSummary,
  editorialBriefFromPackage,
  loadSiblingDrafts,
  renderProtectedFactsForEditor,
} from '@bb/editorial-intelligence';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { BlogPackage, ContentDnaRecord, EditorialBrief, LearningEvent } from '@bb/shared-types';
import { ContentItemNotFoundError, addRevision, getContentItem, recordQaResult } from '@bb/workflows';

import { DraftBlogArticleOutputSchema } from './draftArticle.js';
import type { DraftBlogArticleOutput } from './draftArticle.js';
import { InvalidArticleHtmlError } from './errors.js';
import { buildArticleHtml } from './htmlBuilder.js';
import { validateBlogHtml } from './htmlValidation.js';
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

Creator's Content DNA:
- Tone: ${dna.voice.tone}
- Forbidden phrases (never use): ${dna.voice.forbiddenPhrases.join(', ') || 'none noted'}

Revise the article per the instruction below. Only change what the instruction asks for (a single
section, the title, a component, formatting, tone, length, etc.) — preserve every other field
exactly as given unless the edit necessarily touches it. Do not invent new facts, sources, numbers
or quotes while revising; do not change the underlying claims unless explicitly asked to.

Optional visual components (comparisonStat, revealCards, poll, pullQuote) work the same as at
drafting time — keep, drop, or add one only if it genuinely fits, never to decorate. Each one's
afterSectionIndex is a 0-based index into the (possibly now-different) "sections" array.${renderProtectedFactsForEditor(brief)}`;
}

function buildReviseUserPrompt(current: DraftBlogArticleOutput, instruction: string): string {
  return `Current article (JSON):
${JSON.stringify(current, null, 2)}

Edit instruction: ${instruction}

Return the FULL revised article using the same JSON shape (titleOptions, category,
metaDescription, deck, thesis, sections, practicalTakeaway, conclusion, disclaimer, sources,
articleSummary, estimatedReadTime, seoStatus, styleMatchStatus, comparisonStat, revealCards, poll,
pullQuote) — every field, not just the ones that changed.`;
}

export interface ReviseBlogArticleInput {
  pool: Pool;
  llm: LlmClient;
  contentId: string;
  instruction: string;
  runId: string;
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
// gets edited; the HTML is deterministically rebuilt from it via htmlBuilder.ts the
// same way a brand-new draft is, so an edit can never produce markup the validator
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

  const dna = await loadCurrentDna(input.pool);

  const revised = await input.llm.completeStructured(
    {
      system: buildReviseSystemPrompt(dna, brief),
      messages: [{ role: 'user', content: buildReviseUserPrompt(currentDraft, input.instruction) }],
      runId: input.runId,
      stepId: `revise-${item.id}`,
    },
    DraftBlogArticleOutputSchema,
  );

  const title = revised.titleOptions[0];
  if (!title) throw new Error('reviseBlogArticle: revision returned no title options');

  const { html } = buildArticleHtml({
    title,
    deck: revised.deck,
    category: revised.category,
    metaDescription: revised.metaDescription,
    sections: revised.sections,
    practicalTakeaway: revised.practicalTakeaway,
    conclusion: revised.conclusion,
    disclaimer: revised.disclaimer,
    sources: revised.sources,
    comparisonStat: revised.comparisonStat,
    revealCards: revised.revealCards,
    poll: revised.poll,
    pullQuote: revised.pullQuote,
  });

  const validation = validateBlogHtml(html);
  if (!validation.valid) throw new InvalidArticleHtmlError(validation.issues);

  const { item: revisedItem } = await addRevision(input.pool, input.contentId, {
    changeType: 'ai_regeneration',
    newText: html,
    changedBy: 'agent',
    changedById: CREATED_BY_AGENT,
    reason: input.instruction,
    package: { ...revised, slug, ...(brief ? { editorialBrief: brief } : {}) },
  });

  const plainText = [
    revised.thesis,
    ...revised.sections.map((s) => `${s.heading}\n${s.body}`),
    revised.practicalTakeaway ?? '',
    revised.conclusion,
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');

  // Same reasoning as headAgent.ts's runBlogArticle: addRevision above already
  // persisted the edit, so a QA (or, below, edit-instruction-classification)
  // provider outage must not throw the result away and leave the human thinking
  // their edit silently failed when it actually landed.
  const qa = await runQaGate({
    finalPost: plainText,
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
            opening: [title, revised.deck].join('. '),
          },
        }
      : {}),
  }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
  await recordQaResult(input.pool, revisedItem.id, revisedItem.currentVersion, qa);

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
    package: buildBlogPackage(revisedItem, revised, slug, qa, brief ? buildEditorialSummary(brief) : null),
    learningEvent,
  };
}
