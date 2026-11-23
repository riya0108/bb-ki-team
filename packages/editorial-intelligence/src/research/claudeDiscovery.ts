import type { ClaudeBackendConfig, ClaudeCodeToolCall, Logger } from '@bb/core';
import { claudeBackendLabel, runClaude } from '@bb/core';
import { z } from 'zod';

import { tierForUrl } from './sourceTiers.js';

// Agentic source DISCOVERY: Claude Code researches the topic the way a human
// researcher would — searching, reading, following the trail to the original survey,
// paper, filing or regulator release, and looking for counter-evidence — and returns
// a reading list of leads.
//
// Leads are never evidence on their own. researchStory re-fetches every lead URL
// through the agent's scoped, logged fetch tool; only what that fetch actually
// returns becomes a research document, and Claude's quoted passages are kept only
// when they are found verbatim in the fetched page. A URL that cannot be fetched
// becomes a discovery-tier note that can never make a claim VERIFIED by itself
// (verifyClaims' evidence ceiling). So the model can widen what we read, but it can
// never put words into a source.

export const DiscoveredLeadSchema = z.object({
  url: z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http(s) only'),
  title: z.string().min(1).max(300),
  publisher: z.string().max(120).nullable().default(null),
  publishedDate: z.string().max(40).nullable().default(null),
  sourceType: z.enum(['primary', 'research', 'news', 'analysis', 'data', 'other']).catch('other'),
  whyItMatters: z.string().max(600).default(''),
  keyFacts: z
    .array(
      z.object({
        fact: z.string().min(1).max(400),
        // Must be copied exactly from the page; checked against the fetched text later.
        verbatimQuote: z.string().max(600).nullable().default(null),
      }),
    )
    .max(8)
    .default([]),
});
export type DiscoveredLead = z.infer<typeof DiscoveredLeadSchema>;

const DiscoveryResponseSchema = z.object({
  leads: z.array(z.unknown()).max(30),
});

export interface DiscoveryRequest {
  topic: string;
  userMessage: string | null;
  // Planned search directions (from topic analysis): explanatory and counter-evidence.
  queries: readonly string[];
  runId: string;
}

export type DiscoveryResearcher = (request: DiscoveryRequest) => Promise<DiscoveredLead[]>;

const STEP_ID = 'editorial-research-discovery';
export const MAX_DISCOVERED_LEADS = 18;

export function buildDiscoverySystemPrompt(today: string): string {
  return `You are the research desk for Bull or Bear, an independent Indian business and ideas publication.
Today is ${today}. You research ONE topic deeply so a writer can produce a long, factually exact essay.
You do not write the article. You find and read the best sources and report what they actually say.

How to research (use WebSearch and WebFetch as many times as the topic needs):
1. Find the ORIGINAL source for every headline fact: the survey report itself (with fieldwork dates,
   sample size, who ran it and who paid for it), the paper (arXiv/ACL/journal page), the regulator or
   company release, the filing, the dataset. A news story ABOUT a study is a lead to the study.
2. Corroborate key numbers with at least two independent reputable outlets where possible (wire services,
   major business papers), and note where outlets disagree.
3. Find context that makes numbers mean something: comparable figures, prior years, other countries,
   the mechanism behind the trend.
4. Actively look for counter-evidence, criticism, methodological limits and conflicts of interest.
5. Find the NEWEST data point for every trend (the latest fiscal year, quarter or month published as of
   today) and say when an older figure has been superseded. If the newest data cuts against the obvious
   story (a trend reversing, a one-year spike fading), that is a key lead, not a footnote.
6. Prefer recent material (check dates against today).
7. Never rely on a page you have not opened. Never guess a URL.

Return ONLY a JSON object, no commentary, no markdown fences:
{"leads":[{"url":"https://...","title":"...","publisher":"...","publishedDate":"YYYY-MM-DD or null",
"sourceType":"primary|research|news|analysis|data|other","whyItMatters":"one or two sentences",
"keyFacts":[{"fact":"the fact in your words","verbatimQuote":"an exact sentence copied from the page, or null"}]}]}

Rules for the JSON:
- 8 to ${MAX_DISCOVERED_LEADS} leads; every url is a page you actually opened.
- List EVERY primary document you opened (survey report, regulator/central-bank release or bulletin,
  official dataset, filing, paper) FIRST, with sourceType "primary", even when a news story summarised
  it — the primary document is what verifies the number. Then at least two independent outlets for each
  headline figure, then context and counter-evidence.
- verbatimQuote is copied character-for-character from that page (it will be checked automatically);
  use null rather than paraphrase.
- Up to 6 keyFacts per lead, each with its exact number, date and who said it.`;
}

export function buildDiscoveryUserPrompt(request: DiscoveryRequest): string {
  return [
    `Topic: ${request.topic}`,
    request.userMessage ? `The editor's original request: ${request.userMessage}` : null,
    request.queries.length > 0 ? `Directions worth covering (adapt freely):\n${request.queries.map((q) => `- ${q}`).join('\n')}` : null,
    'Research it now and return the JSON.',
  ]
    .filter((l): l is string => l !== null)
    .join('\n\n');
}

function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in research output');
  return JSON.parse(candidate.slice(start, end + 1));
}

// Lenient per lead: one malformed lead is dropped, never the whole reading list.
export function parseDiscoveryOutput(text: string): DiscoveredLead[] {
  const parsed = DiscoveryResponseSchema.parse(extractJsonObject(text));
  const seen = new Set<string>();
  const leads: DiscoveredLead[] = [];
  for (const raw of parsed.leads) {
    const lead = DiscoveredLeadSchema.safeParse(raw);
    if (!lead.success || seen.has(lead.data.url)) continue;
    seen.add(lead.data.url);
    leads.push(lead.data);
  }
  return leads.slice(0, MAX_DISCOVERED_LEADS);
}

// Claude often opens the regulator's report or the central bank's bulletin, then
// lists only the news stories about it. Any primary-domain page it opened joins the
// reading list (ahead of the cap), so the agent fetches and reads it itself.
const MAX_ADDED_PRIMARY = 6;

export function withOpenedPrimaryDocuments(leads: readonly DiscoveredLead[], toolCalls: readonly ClaudeCodeToolCall[]): DiscoveredLead[] {
  const listed = new Set(leads.map((l) => l.url));
  const added: DiscoveredLead[] = [];
  for (const call of toolCalls) {
    if (added.length >= MAX_ADDED_PRIMARY) break;
    if (call.name !== 'WebFetch') continue;
    const url = describeToolInput(call.input).url;
    if (typeof url !== 'string' || listed.has(url) || tierForUrl(url) !== 'primary') continue;
    const lead = DiscoveredLeadSchema.safeParse({ url, title: url, sourceType: 'primary', whyItMatters: 'Primary document opened during research.' });
    if (!lead.success) continue;
    listed.add(url);
    added.push(lead.data);
  }
  return [...leads, ...added];
}

function describeToolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) return {};
  const record = input as Record<string, unknown>;
  return {
    ...(typeof record.query === 'string' ? { query: record.query } : {}),
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
  };
}

export interface CreateClaudeDiscoveryOptions {
  // Tried in order (local Claude Code CLI, then the Anthropic API); the first that
  // returns parseable leads wins.
  config: ClaudeBackendConfig | readonly ClaudeBackendConfig[];
  logger: Logger;
  now?: () => Date;
  run?: typeof runClaude;
}

export function createClaudeCodeDiscoveryResearcher(options: CreateClaudeDiscoveryOptions): DiscoveryResearcher {
  const run = options.run ?? runClaude;
  const now = options.now ?? (() => new Date());
  const backends: readonly ClaudeBackendConfig[] = Array.isArray(options.config) ? options.config : [options.config as ClaudeBackendConfig];
  return async (request) => {
    const { logger } = options;
    let lastError: unknown = new Error('no Claude backend configured for research');
    for (const backend of backends) {
      try {
        const result = await run(
          backend,
          {
            system: buildDiscoverySystemPrompt(now().toISOString().slice(0, 10)),
            prompt: buildDiscoveryUserPrompt(request),
            tools: ['WebSearch', 'WebFetch'],
            runId: request.runId,
            stepId: STEP_ID,
            // CLAUDE.md: every external fetch is logged with the run's correlation IDs.
            onToolCall: (call) => {
              logger.info({ runId: request.runId, stepId: STEP_ID, tool: call.name, ...describeToolInput(call.input) }, 'Claude research tool call');
            },
          },
          logger,
        );
        const listed = parseDiscoveryOutput(result.text);
        const leads = withOpenedPrimaryDocuments(listed, result.toolCalls);
        logger.info(
          {
            runId: request.runId,
            stepId: STEP_ID,
            backend: claudeBackendLabel(backend),
            leads: leads.length,
            addedPrimary: leads.length - listed.length,
            toolCalls: result.toolCalls.length,
          },
          'Claude research discovery complete',
        );
        return leads;
      } catch (error) {
        lastError = error;
        logger.warn(
          { runId: request.runId, stepId: STEP_ID, backend: claudeBackendLabel(backend), err: error instanceof Error ? error.message : String(error) },
          'Claude research backend failed',
        );
      }
    }
    throw lastError;
  };
}

// Quote check against fetched page text, tolerant of whitespace, case and
// typographic quote/dash differences — nothing else.
function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The quotes (in order) that appear verbatim in the fetched page.
export function quotesFoundIn(quotes: readonly string[], pageText: string): string[] {
  const page = normalizeForQuote(pageText);
  return quotes.filter((quote) => {
    const q = normalizeForQuote(quote);
    return q.length >= 12 && page.includes(q);
  });
}
