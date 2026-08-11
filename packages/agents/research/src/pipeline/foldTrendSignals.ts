import type { TrendSignal } from '@ai-company/shared-types';
import type { TopicCluster } from './evaluateRelevance.js';

export type TopicClusterItem = TopicCluster['topics'][number];

export interface TopicWithSignals extends TopicClusterItem {
  supportingSignals: TrendSignal[];
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4),
  );
}

/**
 * Matches Trend Research's signals to Research's topic clusters so
 * scoreTopics.ts can weigh momentum/opportunity into its scoring — a
 * signal supports a topic if it shares a source domain with the topic's
 * cited sources, or if its title/description shares a significant word
 * with the topic's name/notes. Deliberately a cheap heuristic (no extra
 * LLM call) since this only needs to narrow candidates, not be precise —
 * scoreTopics.ts's own LLM call does the actual judgment.
 */
export function foldTrendSignals(
  topics: TopicClusterItem[],
  signals: TrendSignal[],
): TopicWithSignals[] {
  return topics.map((topic) => {
    const topicDomains = new Set(topic.sourceUrls.map(domain));
    const topicWords = significantWords(`${topic.topic} ${topic.relevanceNotes}`);

    const supportingSignals = signals.filter((signal) => {
      if (topicDomains.has(domain(signal.evidenceUrl))) return true;
      const signalWords = significantWords(`${signal.title} ${signal.description}`);
      for (const word of signalWords) {
        if (topicWords.has(word)) return true;
      }
      return false;
    });

    return { ...topic, supportingSignals };
  });
}
