import type { LlmClient, Logger } from '@bb/core';
import { classifyHighRiskTopic } from '@bb/qa-gate';
import type { RiskLevel, UserRequestAnalysis } from '@bb/shared-types';
import { RiskLevelSchema, UserRequestAnalysisSchema } from '@bb/shared-types';
import { z } from 'zod';

// Spec 33/34/35/45: decide whether a topic needs research (news/current/factual) or
// can be written from Brand Brain + Content DNA alone (evergreen/opinion), and split the
// user's message into candidate facts vs. editorial direction. The LLM proposes; a
// deterministic floor can only make research MORE likely and risk HIGHER, never less.

export const TopicKindSchema = z.enum(['news', 'current_factual', 'evergreen_factual', 'evergreen_explainer', 'opinion']);
export type TopicKind = z.infer<typeof TopicKindSchema>;

export const TopicAnalysisSchema = z.object({
  topicKind: TopicKindSchema,
  needsResearch: z.boolean(),
  riskLevel: RiskLevelSchema,
  // A short, search-friendly statement of the story (no hooks, no style).
  normalizedTopic: z.string().min(1),
  searchQueries: z.array(z.string().min(2)).min(1).max(4),
  entities: z.array(z.string()).default([]),
  userRequest: UserRequestAnalysisSchema,
});
export type TopicAnalysis = z.infer<typeof TopicAnalysisSchema> & { riskFlags: string[]; usedFallback: boolean };

const NEWS_SIGNAL =
  /\b(just|today|yesterday|this week|this month|breaking|announced|announces|hiked|hikes|cut|cuts|raised|raises|slashed|launched|launches|reported|reports|filed|approved|proposed|banned|bans|imposed|acquired|merger|acquisition|ipo|earnings|quarterly results|q[1-4]|budget|policy|repo rate|interest rates?|inflation|gdp|tariffs?|election|court|ruling|verdict|lawsuit|rbi|sebi|fed|federal reserve|ecb|ministry|minister|government|regulator|crore|lakh|billion|million)\b|\d{2,}|%/i;

const IMPERATIVE_OPENING = /^\s*(please\s+)?(draft|write|make|create|give|turn|post|reframe|rewrite|do|generate|compose|prepare)\b/i;
const HOOK_LABEL = /^\s*(reframed\s+)?hook\s*[:-]/i;
const URL_PATTERN = /https?:\/\/[^\s)>\]]+/g;

export function hasFactualSignal(text: string): boolean {
  return NEWS_SIGNAL.test(text);
}

export function extractUrls(text: string): string[] {
  return [...new Set(text.match(URL_PATTERN) ?? [])];
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

// Deterministic split of a raw request when the LLM is unavailable: lines that state
// something checkable become candidate facts; labelled hooks become hook suggestions;
// instructions are dropped (they're not evidence).
export function fallbackUserRequest(message: string): UserRequestAnalysis {
  const candidateFacts: string[] = [];
  const hookSuggestions: string[] = [];
  const lines = message
    .replace(URL_PATTERN, '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  let nextIsHook = false;
  for (const line of lines) {
    if (HOOK_LABEL.test(line)) {
      const rest = line.replace(HOOK_LABEL, '').trim();
      if (rest) hookSuggestions.push(rest);
      else nextIsHook = true;
      continue;
    }
    if (nextIsHook) {
      hookSuggestions.push(line);
      nextIsHook = false;
      continue;
    }
    if (IMPERATIVE_OPENING.test(line) || /:\s*$/.test(line)) continue;
    if (hasFactualSignal(line)) candidateFacts.push(line);
  }
  return { candidateFacts, editorialIntent: [], styleRequests: [], angleRequests: [], hookSuggestions };
}

function buildSystemPrompt(): string {
  return `ROLE: editorial-topic-analyst
You read a content request for Bull or Bear (an independent money/markets/business/tech explainer
brand) and decide what the story is and whether it needs research. You never write content.

- topicKind: news (a specific recent event), current_factual (current state of something that changes),
  evergreen_factual (stable facts that still need checking), evergreen_explainer (how something works),
  opinion (views/advice that need no external facts).
- needsResearch: true for news, current_factual and evergreen_factual — anything where a specific
  fact, number, date, quote or event could be wrong. False only for opinion or a generic explainer.
- riskLevel: high for finance/investment claims, politics, health, legal/tax, accusations, breaking
  news, statistics or geopolitics; medium for business/product/market news; low for evergreen.
- searchQueries: 1-4 short news-search queries that would find primary and reputable coverage.
- userRequest: split the user's message.
  candidateFacts = factual statements the user asserted (e.g. "RBI hiked rates for the first time since
  2023") — copy them faithfully, keep every qualifier ("first", "since 2023", "proposed", "could").
  editorialIntent = what the piece should focus on ("make it about borrowers").
  styleRequests = tone/format asks. angleRequests = explicit angles. hookSuggestions = hooks/openings
  the user wrote. Instructions and style are NEVER facts.`;
}

export interface AnalyzeTopicInput {
  topic: string;
  userMessage: string | null;
  angle: string | null;
  llm: LlmClient;
  logger: Logger;
  runId: string;
}

export async function analyzeTopic(input: AnalyzeTopicInput): Promise<TopicAnalysis> {
  const stepId = 'editorial-analyze-topic';
  const requestText = [input.userMessage, input.topic, input.angle].filter(Boolean).join('\n');
  const deterministicRisk = classifyHighRiskTopic(requestText);
  const deterministicNeedsResearch = hasFactualSignal(`${input.topic}\n${input.userMessage ?? ''}`);

  try {
    const analysis = await input.llm.completeStructured(
      {
        system: buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: `Topic: ${input.topic}\n${input.angle ? `Requested angle: ${input.angle}\n` : ''}Full user message:\n${input.userMessage ?? input.topic}`,
          },
        ],
        runId: input.runId,
        stepId,
        temperature: 0,
      },
      TopicAnalysisSchema,
    );
    return {
      ...analysis,
      needsResearch: analysis.needsResearch || deterministicNeedsResearch,
      riskLevel: maxRiskLevel(analysis.riskLevel, deterministicRisk.riskLevel),
      riskFlags: deterministicRisk.riskFlags,
      userRequest: {
        ...analysis.userRequest,
        angleRequests: input.angle && !analysis.userRequest.angleRequests.includes(input.angle)
          ? [...analysis.userRequest.angleRequests, input.angle]
          : analysis.userRequest.angleRequests,
      },
      usedFallback: false,
    };
  } catch (error) {
    input.logger.warn(
      { runId: input.runId, stepId, err: error instanceof Error ? error.message : String(error) },
      'Topic analysis LLM call failed, using deterministic classification',
    );
    const userRequest = fallbackUserRequest(input.userMessage ?? input.topic);
    return {
      topicKind: deterministicNeedsResearch ? 'news' : 'opinion',
      needsResearch: deterministicNeedsResearch,
      riskLevel: deterministicRisk.riskLevel,
      riskFlags: deterministicRisk.riskFlags,
      normalizedTopic: input.topic,
      searchQueries: [input.topic.slice(0, 120)],
      entities: [],
      userRequest: input.angle ? { ...userRequest, angleRequests: [input.angle] } : userRequest,
      usedFallback: true,
    };
  }
}
