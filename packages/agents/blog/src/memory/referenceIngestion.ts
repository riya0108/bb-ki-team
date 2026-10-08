import type { LlmClient, Logger } from '@bb/core';
import type { Queryable } from '@bb/db';
import { upsertStyleSample } from '@bb/db';
import type { FetchTool } from '@bb/mcp-client';
import type { StyleSample, StyleSampleKind, StyleTraits } from '@bb/shared-types';
import { StyleTraitsSchema } from '@bb/shared-types';

import { computeStyleMetrics, shapeFromPlainText } from '../editorial/styleMetrics.js';

// Spec 11: ingest an approved reference article (Bull or Bear's own, an approved
// Substack/INDmoney piece, or one the user pastes) as an ABSTRACTED style sample. The
// article text is measured and characterised, then discarded: only numbers and short
// trait labels are stored, and any trait that reproduces an 8+ word run of the source
// is dropped, so no reference writer's sentences can leak into the writer's prompt.

const MAX_TRAIT_CHARS = 140;
const VERBATIM_WINDOW = 8;

const NO_TRAITS: StyleTraits = {
  openingTechnique: null,
  transitionPatterns: [],
  conclusionPattern: null,
  evidenceUse: null,
  narrativeUse: null,
  conversationality: null,
  editorialDepth: null,
  directness: null,
  skepticism: null,
  warmth: null,
  formality: null,
};

function normalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

// True when `trait` contains any VERBATIM_WINDOW-word run that also occurs in `source`.
export function copiesSource(trait: string, source: string): boolean {
  const t = normalizedWords(trait);
  if (t.length < VERBATIM_WINDOW) return false;
  const haystack = ` ${normalizedWords(source).join(' ')} `;
  for (let i = 0; i + VERBATIM_WINDOW <= t.length; i += 1) {
    if (haystack.includes(` ${t.slice(i, i + VERBATIM_WINDOW).join(' ')} `)) return true;
  }
  return false;
}

export function sanitizeTraits(traits: StyleTraits, source: string): StyleTraits {
  const keep = (value: string | null): string | null =>
    value === null || value.length > MAX_TRAIT_CHARS || copiesSource(value, source) ? null : value;
  return {
    ...traits,
    openingTechnique: keep(traits.openingTechnique),
    conclusionPattern: keep(traits.conclusionPattern),
    evidenceUse: keep(traits.evidenceUse),
    narrativeUse: keep(traits.narrativeUse),
    transitionPatterns: traits.transitionPatterns
      .map((t) => keep(t))
      .filter((t): t is string => t !== null)
      .slice(0, 6),
  };
}

async function extractTraits(text: string, llm: LlmClient, runId: string): Promise<StyleTraits> {
  const traits = await llm.completeStructured(
    {
      system: `ROLE: blog-style-analyst
You characterise HOW an article is written so a different writer can learn the craft without copying it.
Describe techniques abstractly ("opens on a counterintuitive number, then a one-line question"), never
quote or closely paraphrase the article, never name the author's signature phrases. Each text field at
most ${MAX_TRAIT_CHARS} characters. Ratings are 0-10.
Fields: openingTechnique, transitionPatterns (up to 6 abstract patterns), conclusionPattern, evidenceUse
(how numbers/sources/tables are used), narrativeUse, conversationality, editorialDepth, directness,
skepticism, warmth, formality.`,
      messages: [{ role: 'user', content: text.slice(0, 9000) }],
      runId,
      stepId: 'blog-style-analyst',
      temperature: 0,
      maxTokens: 900,
    },
    StyleTraitsSchema,
  );
  return sanitizeTraits(traits, text);
}

export type ReferenceSource = { kind: 'url'; url: string } | { kind: 'text'; text: string };

export interface IngestReferenceInput {
  db: Queryable;
  llm: LlmClient;
  fetchTool: FetchTool;
  logger: Logger;
  runId: string;
  kind: Exclude<StyleSampleKind, 'approved_article'>;
  label: string;
  source: ReferenceSource;
}

export class ReferenceArticleTooShortError extends Error {
  constructor(words: number) {
    super(`Reference article is too short to learn a style from (${words} words; need at least 300).`);
    this.name = 'ReferenceArticleTooShortError';
  }
}

export async function ingestStyleReference(input: IngestReferenceInput): Promise<StyleSample> {
  let text: string;
  let sourceUrl: string | null = null;
  if (input.source.kind === 'url') {
    input.logger.info({ runId: input.runId, stepId: 'blog-style-reference-fetch', url: input.source.url }, 'Fetching style reference article');
    const fetched = await input.fetchTool.fetchUrl(input.source.url);
    text = fetched.text;
    sourceUrl = input.source.url;
  } else {
    text = input.source.text;
  }

  const shape = shapeFromPlainText(text);
  const metrics = computeStyleMetrics(shape);
  if (metrics.wordCount < 300) throw new ReferenceArticleTooShortError(metrics.wordCount);

  const traits = await extractTraits(text, input.llm, input.runId).catch((error: unknown) => {
    input.logger.warn(
      { runId: input.runId, stepId: 'blog-style-analyst', err: error instanceof Error ? error.message : String(error) },
      'Style trait extraction failed; storing measured metrics only',
    );
    return NO_TRAITS;
  });

  return upsertStyleSample(input.db, { kind: input.kind, label: input.label, sourceUrl, contentId: null, metrics, traits });
}
