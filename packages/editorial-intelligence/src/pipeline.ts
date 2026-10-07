import { randomUUID } from 'node:crypto';

import type { LlmClient, Logger } from '@bb/core';
import type { Pool } from '@bb/db';
import { findRecentEditorialBrief, listContentItemsByEditorialBriefId, listSources } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import type { SiblingDraft } from '@bb/qa-gate';
import { contentStems, sharedStemCount } from '@bb/qa-gate';
import type { Claim, ContentDnaRecord, EditorialBrief, HookCandidate, ScoredHook } from '@bb/shared-types';
import { EditorialBriefSchema, isUsableClaim } from '@bb/shared-types';

import { analyzeSignificance, fallbackEssence } from './analyzeSignificance.js';
import type { TopicAnalysis } from './analyzeTopic.js';
import { analyzeTopic, extractUrls } from './analyzeTopic.js';
import { buildEditorialBrief } from './buildEditorialBrief.js';
import { critiqueHooks, fallbackHook, rankAccepted } from './critiqueHooks.js';
import { extractClaims, userFactsAsUnverifiedClaims } from './extractClaims.js';
import { generateHooks } from './generateHooks.js';
import type { ProvidedDocument, ResearchDossier } from './research/researchStory.js';
import { researchStory } from './research/researchStory.js';
import { tierForRegistrySource } from './research/sourceTiers.js';
import { selectAngle } from './selectAngles.js';
import { deriveThingsNotToSay } from './thingsNotToSay.js';
import { normalizeTopicKey } from './topicKey.js';
import { verifyClaims } from './verifyClaims.js';
import { editorialBriefFromPackage, htmlToPlainText } from './writerBrief.js';

// The Editorial Intelligence pipeline (spec 1/33/46):
//   topic understanding -> research -> claim extraction -> verification ->
//   significance + angles -> angle selection -> hooks -> hook critique -> EditorialBrief
// Owned by the backend; platform agents call prepareEditorialBrief and then only
// write. One research pass per story: a brief for the same topic created within
// BRIEF_REUSE_WINDOW_MS is reused by the next platform instead of re-researching.

export const BRIEF_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const SELECTED_HOOK_COUNT = 3;

export interface EditorialDeps {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  logger: Logger;
}

export interface PrepareEditorialBriefInput {
  topic: string;
  // The user's full original message, when the request came from chat: carries facts
  // and hook suggestions that the intent classifier's short `topic` drops.
  userMessage?: string | null;
  angle?: string | null;
  providedDocuments?: ProvidedDocument[];
  contentDna: ContentDnaRecord;
  runId: string;
  // Defaults to true; source-led flows with their own documents never reuse.
  reuseExisting?: boolean;
}

function logStep(deps: EditorialDeps, runId: string, stepId: string, msg: string, extra: Record<string, unknown> = {}): void {
  deps.logger.info({ runId, stepId, ...extra }, msg);
}

async function findReusableBrief(deps: EditorialDeps, topicKey: string): Promise<EditorialBrief | null> {
  const raw = await findRecentEditorialBrief(deps.pool, topicKey, new Date(Date.now() - BRIEF_REUSE_WINDOW_MS));
  if (raw === null) return null;
  const parsed = EditorialBriefSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function relevantRegistrySources(
  deps: EditorialDeps,
  topic: string,
): Promise<{ url: string; name: string; tier: ReturnType<typeof tierForRegistrySource> }[]> {
  const topicStems = contentStems(topic);
  const sources = await listSources(deps.pool, { status: 'active' });
  return sources
    .filter((s) => s.tier !== 'tier_3_community')
    .filter((s) => sharedStemCount(contentStems([s.name, ...s.topics].join(' ')), topicStems) >= 1)
    .slice(0, 3)
    .map((s) => ({ url: s.url, name: s.name, tier: tierForRegistrySource(s.tier) }));
}

async function selectHooks(
  deps: EditorialDeps,
  input: PrepareEditorialBriefInput,
  analysis: TopicAnalysis,
  claims: Claim[],
  essence: NonNullable<EditorialBrief['storyEssence']>,
  angle: EditorialBrief['selectedAngle'],
  thingsNotToSay: string[],
): Promise<{ scored: ScoredHook[]; selected: HookCandidate[] }> {
  const generate = async (feedback?: string[]): Promise<HookCandidate[]> =>
    generateHooks({
      essence,
      angle,
      claims,
      hookSuggestions: analysis.userRequest.hookSuggestions,
      contentDna: input.contentDna,
      llm: deps.llm,
      runId: input.runId,
      ...(feedback ? { rejectionFeedback: feedback } : {}),
    }).catch((error: unknown) => {
      deps.logger.warn({ runId: input.runId, stepId: 'editorial-hooks', err: error instanceof Error ? error.message : String(error) }, 'Hook generation failed');
      return [];
    });

  let scored: ScoredHook[] = [];
  const first = await generate();
  if (first.length > 0) {
    scored = await critiqueHooks({
      hooks: first,
      claims,
      angleClaimIds: angle?.supportingClaimIds ?? [],
      thingsNotToSay,
      llm: deps.llm,
      logger: deps.logger,
      runId: input.runId,
    });
  }
  // Spec 44: if hook validation fails, regenerate once with the rejection reasons.
  if (rankAccepted(scored).length === 0) {
    const feedback = scored.flatMap((s) => s.rejectionReasons.map((r) => `"${s.candidate.text}": ${r}`)).slice(0, 12);
    const retry = await generate(feedback.length > 0 ? feedback : ['No usable hooks were produced.']);
    if (retry.length > 0) {
      scored = [
        ...scored,
        ...(await critiqueHooks({
          hooks: retry,
          claims,
          angleClaimIds: angle?.supportingClaimIds ?? [],
          thingsNotToSay,
          llm: deps.llm,
          logger: deps.logger,
          runId: input.runId,
          stepId: 'editorial-hook-critique-retry',
        })),
      ];
    }
  }
  const accepted = rankAccepted(scored).slice(0, SELECTED_HOOK_COUNT).map((s) => s.candidate);
  if (accepted.length > 0) return { scored, selected: accepted };
  const fallback = fallbackHook(claims);
  deps.logger.warn({ runId: input.runId, stepId: 'editorial-hook-critique' }, 'All hooks rejected twice; using the top verified claim as the hook');
  return { scored, selected: fallback ? [fallback] : [] };
}

export async function prepareEditorialBrief(deps: EditorialDeps, input: PrepareEditorialBriefInput): Promise<EditorialBrief> {
  const { runId } = input;
  const providedDocuments = input.providedDocuments ?? [];
  const topicKey = normalizeTopicKey(input.topic);

  if ((input.reuseExisting ?? true) && providedDocuments.length === 0) {
    const reusable = await findReusableBrief(deps, topicKey);
    if (reusable) {
      logStep(deps, runId, 'editorial-reuse', 'Reusing a recent editorial brief for this topic', { briefId: reusable.id });
      return reusable;
    }
  }

  const analysis = await analyzeTopic({
    topic: input.topic,
    userMessage: input.userMessage ?? null,
    angle: input.angle ?? null,
    llm: deps.llm,
    logger: deps.logger,
    runId,
  });
  logStep(deps, runId, 'editorial-analyze-topic', 'Topic analysed', {
    topicKind: analysis.topicKind,
    needsResearch: analysis.needsResearch,
    riskLevel: analysis.riskLevel,
    usedFallback: analysis.usedFallback,
  });

  const base = {
    id: randomUUID(),
    runId,
    topic: input.topic,
    topicKey,
    riskLevel: analysis.riskLevel,
    riskFlags: analysis.riskFlags,
    userRequest: analysis.userRequest,
    contentDnaVersion: input.contentDna.version,
  };

  // Spec 45: evergreen/opinion requests don't pay for research.
  if (!analysis.needsResearch && providedDocuments.length === 0) {
    return buildEditorialBrief({
      ...base,
      kind: 'opinion',
      research: { queries: [], documentsConsidered: 0, documentsUsed: 0, failures: [] },
      sources: [],
      claims: [],
      storyEssence: null,
      selectedAngle: null,
      hookCandidates: [],
      selectedHooks: [],
      thingsNotToSay: [],
      uncertaintyNotes: [],
      temporalNotes: [],
    });
  }

  const dossier: ResearchDossier = await researchStory({
    topic: analysis.normalizedTopic,
    queries: analysis.searchQueries,
    userUrls: extractUrls(input.userMessage ?? ''),
    providedDocuments,
    registrySources: await relevantRegistrySources(deps, `${input.topic} ${analysis.normalizedTopic}`),
    fetchTool: deps.fetchTool,
    logger: deps.logger,
    runId,
  });
  const research = {
    queries: dossier.queries,
    documentsConsidered: dossier.documentsConsidered,
    documentsUsed: dossier.documents.length,
    failures: dossier.failures,
  };
  const sources = dossier.documents.map((d) => d.source);

  const insufficient = (claims: Claim[], note: string): EditorialBrief =>
    buildEditorialBrief({
      ...base,
      kind: 'insufficient_evidence',
      research,
      sources,
      claims,
      storyEssence: null,
      selectedAngle: null,
      hookCandidates: [],
      selectedHooks: [],
      thingsNotToSay: deriveThingsNotToSay(claims),
      uncertaintyNotes: [note],
      temporalNotes: [],
    });

  // Spec 44: research failure never becomes fabricated research.
  if (dossier.documents.length === 0) {
    deps.logger.warn({ runId, stepId: 'editorial-research' }, 'No research documents gathered — insufficient evidence');
    return insufficient(userFactsAsUnverifiedClaims(analysis.userRequest.candidateFacts), 'No sources could be gathered for this topic.');
  }

  let extracted: Claim[];
  try {
    extracted = await extractClaims({
      topic: analysis.normalizedTopic,
      documents: dossier.documents,
      candidateFacts: analysis.userRequest.candidateFacts,
      llm: deps.llm,
      runId,
    });
  } catch (error) {
    deps.logger.warn({ runId, stepId: 'editorial-extract-claims', err: error instanceof Error ? error.message : String(error) }, 'Claim extraction failed');
    return insufficient(userFactsAsUnverifiedClaims(analysis.userRequest.candidateFacts), 'Claim extraction failed; nothing could be verified.');
  }
  logStep(deps, runId, 'editorial-extract-claims', 'Claims extracted', { claims: extracted.length });

  const verified = await verifyClaims({ claims: extracted, documents: dossier.documents, llm: deps.llm, logger: deps.logger, runId });
  if (!verified.some(isUsableClaim)) {
    return insufficient(verified, 'Sources were found, but no claim could be verified against them.');
  }

  let claims = verified;
  let essence = fallbackEssence(claims);
  let extraThingsNotToSay: string[] = [];
  let uncertaintyNotes: string[];
  let temporalNotes: string[] = [];
  try {
    const significance = await analyzeSignificance({
      topic: analysis.normalizedTopic,
      claims,
      userRequest: analysis.userRequest,
      contentDna: input.contentDna,
      llm: deps.llm,
      runId,
    });
    claims = significance.rankedClaims;
    essence = significance.essence;
    extraThingsNotToSay = significance.thingsNotToSay;
    uncertaintyNotes = significance.uncertaintyNotes;
    temporalNotes = significance.temporalNotes;
  } catch (error) {
    deps.logger.warn({ runId, stepId: 'editorial-significance', err: error instanceof Error ? error.message : String(error) }, 'Significance analysis failed; using ledger-only essence');
    uncertaintyNotes = ['Significance analysis was unavailable; the story essence is a plain restatement of the top verified claim.'];
  }
  if (!essence) return insufficient(claims, 'No usable claims to build a story from.');

  const angle = selectAngle(essence.editorialAngles, claims, analysis.riskLevel);
  logStep(deps, runId, 'editorial-select-angle', 'Angle selected', { angleId: angle?.id ?? null, angles: essence.editorialAngles.length });

  const thingsNotToSay = [...deriveThingsNotToSay(claims), ...extraThingsNotToSay];
  const hooks = await selectHooks(deps, input, analysis, claims, essence, angle, thingsNotToSay);
  logStep(deps, runId, 'editorial-hook-critique', 'Hooks selected', {
    candidates: hooks.scored.length,
    rejected: hooks.scored.filter((s) => s.rejected).length,
    selected: hooks.selected.map((h) => h.id),
  });

  const unusableNotes = claims
    .filter((c) => !isUsableClaim(c) && c.origin === 'user')
    .map((c) => `User-supplied claim not verified (${c.verificationStatus}): "${c.text}"${c.notes ? ` — ${c.notes}` : ''}`);

  const brief = buildEditorialBrief({
    ...base,
    kind: 'researched',
    research,
    sources,
    claims,
    storyEssence: essence,
    selectedAngle: angle,
    hookCandidates: hooks.scored,
    selectedHooks: hooks.selected,
    thingsNotToSay,
    uncertaintyNotes: [...uncertaintyNotes, ...unusableNotes],
    temporalNotes,
  });
  logStep(deps, runId, 'editorial-brief', 'Editorial brief ready', { briefId: brief.id, kind: brief.kind, claims: brief.claims.length });
  return brief;
}

// Other platforms' drafts built from the same brief, for cross-platform QA (spec 26).
export async function loadSiblingDrafts(pool: Pool, briefId: string, excludeContentId?: string): Promise<SiblingDraft[]> {
  const items = await listContentItemsByEditorialBriefId(pool, briefId);
  return items
    .filter((i) => i.id !== excludeContentId && editorialBriefFromPackage(i.package) !== null)
    .map((i) => ({ platform: i.platform, text: i.platform === 'blog' ? htmlToPlainText(i.currentText) : i.currentText }));
}
