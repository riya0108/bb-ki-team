import type { Logger, LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import type { Pool } from '@bb/db';
import { listSources, markSourceAccessed, updateSourceStatus } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import { FetchToolError } from '@bb/mcp-client';
import { buildQaGateUnavailableResult, runQaGate } from '@bb/qa-gate';
import type { ContentDnaRecord, Source, XPackage } from '@bb/shared-types';
import { RiskLevelSchema } from '@bb/shared-types';
import { createContentItem, listContentItems, recordQaResult, submitForReview } from '@bb/workflows';
import { z } from 'zod';

import { draftXPost } from './draftPost.js';
import { InsufficientDistinctTopicsError, NoAccessibleSourcesError, NoTrustedSourcesError } from './errors.js';
import { buildXPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-02-x';
const RECENT_TOPICS_LIMIT = 20;
const DEFAULT_TOPICS_TO_SELECT = 1;

const CandidateTopicSchema = z.object({
  sourceUrl: z.string().url(),
  topic: z.string(),
  coreClaim: z.string().nullable(),
  angle: z.string(),
  relevanceScore: z.number().min(0).max(1),
  riskLevel: RiskLevelSchema,
});
export type CandidateTopic = z.infer<typeof CandidateTopicSchema>;

const CandidateTopicsResponseSchema = z.object({ candidates: z.array(CandidateTopicSchema) });

export interface FetchedSource {
  source: Source;
  text: string;
  title: string | null;
}

function buildCandidateExtractionSystemPrompt(dna: ContentDnaRecord): string {
  return `You are the trend/idea-discovery half of Agent 02 — the Bull or Bear X Content Head Agent
(spec 6.1). You inspect trusted sources and identify ideas worth posting about. You are a research
lead, not a ghostwriter (spec 5.5, cross-platform): extract topics and angles, never sentences to copy.

Creator's Content DNA:
- Primary topics: ${dna.topics.primary.join(', ') || 'none noted'}
- Topics to avoid: ${dna.topics.avoid.join(', ') || 'none noted'}
- Expertise: ${dna.identity.expertise.join(', ') || 'unspecified'}

Rules:
- Only propose a topic actually supported by the supplied source text — never invent one.
- Give each candidate its own distinct angle; do not propose variations of the same underlying idea.
- Skip anything already covered by the recently published topics listed below.
- coreClaim is the one specific, checkable claim the post would center on, or null if it doesn't
  hinge on one.
- riskLevel should be "high" for anything touching legal, medical, safety-critical or unverified
  financial-outcome claims; otherwise "low" or "medium".`;
}

function buildCandidateExtractionUserPrompt(fetched: FetchedSource[], recentTopics: string[]): string {
  const sourceBlock = fetched
    .map((f, i) => `--- Source ${i + 1}: ${f.source.url} ---\n${f.text.slice(0, 4000)}`)
    .join('\n\n');
  const recentBlock =
    recentTopics.length > 0
      ? `Recently published topics (do not repeat these):\n${recentTopics.map((t) => `- ${t}`).join('\n')}`
      : 'No recently published topics on record.';

  return `${sourceBlock}\n\n${recentBlock}\n\nExtract candidate topics as JSON: { "candidates": [...] }.`;
}

async function extractCandidateTopics(
  fetched: FetchedSource[],
  recentTopics: string[],
  dna: ContentDnaRecord,
  llm: LlmClient,
  runId: string,
): Promise<CandidateTopic[]> {
  const response = await llm.completeStructured(
    {
      system: buildCandidateExtractionSystemPrompt(dna),
      messages: [{ role: 'user', content: buildCandidateExtractionUserPrompt(fetched, recentTopics) }],
      runId,
      stepId: 'extract-candidate-topics',
    },
    CandidateTopicsResponseSchema,
  );
  return response.candidates;
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

export function selectDistinctTopics(candidates: CandidateTopic[], count: number): CandidateTopic[] {
  const byTopic = new Map<string, CandidateTopic>();
  for (const candidate of candidates) {
    const key = normalizeTopic(candidate.topic);
    const existing = byTopic.get(key);
    if (!existing || candidate.relevanceScore > existing.relevanceScore) {
      byTopic.set(key, candidate);
    }
  }
  const distinct = [...byTopic.values()].sort((a, b) => b.relevanceScore - a.relevanceScore);
  if (distinct.length < count) {
    throw new InsufficientDistinctTopicsError(distinct.length, count);
  }
  return distinct.slice(0, count);
}

export interface RunSourceDiscoveryDeps {
  pool: Pool;
  llm: LlmClient;
  fetchTool: FetchTool;
  logger: Logger;
  runId: string;
  topicCount?: number;
}

// Spec 6.1's Trend/idea discovery mode. Scans trusted X sources (sources table rows
// with platform: 'x'), drafts each selected idea as X-native content (letting the
// model decide single-vs-thread per spec 6.3), and submits for review. Never
// schedules or publishes — Phase 2 has no publish connector.
export async function runSourceDiscovery(deps: RunSourceDiscoveryDeps): Promise<XPackage[]> {
  const { pool, llm, fetchTool, logger, runId } = deps;
  const topicCount = deps.topicCount ?? DEFAULT_TOPICS_TO_SELECT;

  const dna = await loadCurrentDna(pool);

  const sources = await listSources(pool, { platform: 'x', status: 'active' });
  if (sources.length === 0) throw new NoTrustedSourcesError();

  const fetched: FetchedSource[] = [];
  for (const source of sources) {
    try {
      const result = await fetchTool.fetchUrl(source.url);
      await markSourceAccessed(pool, source.id);
      fetched.push({ source, text: result.text, title: result.title });
    } catch (error) {
      if (error instanceof FetchToolError) {
        logger.warn(
          { runId, sourceId: source.id, url: source.url, err: error.message },
          'Trusted source inaccessible, marking and skipping',
        );
        await updateSourceStatus(pool, source.id, 'inaccessible');
        continue;
      }
      throw error;
    }
  }
  if (fetched.length === 0) throw new NoAccessibleSourcesError();

  const recentItems = await listContentItems(pool, { platform: 'x' });
  const recentTopics = recentItems
    .slice(0, RECENT_TOPICS_LIMIT)
    .map((item) => item.topic)
    .filter((topic): topic is string => topic !== null);

  const rawCandidates = await extractCandidateTopics(fetched, recentTopics, dna, llm, runId);

  const fetchedByUrl = new Map(fetched.map((f) => [f.source.url, f]));
  const validCandidates = rawCandidates.filter((candidate) => {
    const known = fetchedByUrl.has(candidate.sourceUrl);
    if (!known) {
      logger.warn({ runId, sourceUrl: candidate.sourceUrl }, 'Dropping candidate with unresolved sourceUrl');
    }
    return known;
  });

  const selected = selectDistinctTopics(validCandidates, topicCount);

  const packages: XPackage[] = [];
  for (const candidate of selected) {
    const fetchedSource = fetchedByUrl.get(candidate.sourceUrl);
    if (!fetchedSource) throw new NoAccessibleSourcesError();

    const draft = await draftXPost({
      topic: candidate.topic,
      angle: candidate.angle,
      coreClaim: candidate.coreClaim,
      sourceTexts: [fetchedSource.text],
      contentDna: dna,
      llm,
      runId,
      stepId: `draft-${candidate.sourceUrl}`,
    });

    const item = await createContentItem(pool, {
      platform: 'x',
      createdByAgent: CREATED_BY_AGENT,
      mode: 'source_discovery',
      topic: candidate.topic,
      coreClaim: candidate.coreClaim,
      angle: candidate.angle,
      sourceIds: [fetchedSource.source.id],
      sourceUrls: [fetchedSource.source.url],
      contentDnaVersion: dna.version,
      text: draft.finalCopy,
      riskLevel: candidate.riskLevel,
      package: { mode: draft.mode, hookOptions: draft.hookOptions, threadPosts: draft.threadPosts },
    });

    const qa = await runQaGate({
      finalPost: draft.finalCopy,
      sourceReferences: [fetchedSource.source.url],
      sourceTexts: [fetchedSource.text],
      contentDna: dna,
      status: item.status,
      llm,
      runId,
      stepId: `qa-${item.id}`,
      platform: 'X',
    }).catch((error: unknown) => buildQaGateUnavailableResult(error instanceof Error ? error.message : String(error)));
    await recordQaResult(pool, item.id, item.currentVersion, qa);

    const reviewedItem = await submitForReview(pool, item.id);
    packages.push(buildXPackage(reviewedItem, draft));
  }

  return packages;
}
