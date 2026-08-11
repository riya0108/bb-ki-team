import { z } from 'zod';
import type { Logger } from '@ai-company/core';
import type { InstagramMcp } from '../mcpClient.js';

const WebSearchOutputSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      description: z.string(),
      publishedAt: z.string().optional(),
    }),
  ),
});

export interface PostCandidate {
  title: string;
  url: string;
  description: string;
  publishedAt?: string;
  matchedTopic: string;
}

const MAX_TOPICS = 8;
const RESULTS_PER_TOPIC = 8;

/** Searches Instagram's indexed content per candidate blog topic, concurrently, skipping individual failures. */
export async function searchPosts(
  instagram: InstagramMcp,
  candidateTopics: string[],
  logger: Logger,
): Promise<PostCandidate[]> {
  const topics = candidateTopics.slice(0, MAX_TOPICS);

  const settled = await Promise.allSettled(
    topics.map(async (topic) => {
      const raw = await instagram.callTool('web_search', { query: topic, count: RESULTS_PER_TOPIC });
      const parsed = WebSearchOutputSchema.parse(raw);
      return { topic, results: parsed.results };
    }),
  );

  const candidates: PostCandidate[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      logger.warn('instagram search failed, skipping', {
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
      continue;
    }
    const { topic, results } = outcome.value;
    for (const r of results) {
      candidates.push({
        title: r.title,
        description: r.description,
        url: r.url,
        matchedTopic: topic,
        ...(r.publishedAt !== undefined ? { publishedAt: r.publishedAt } : {}),
      });
    }
  }

  const seen = new Set<string>();
  return candidates.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}
