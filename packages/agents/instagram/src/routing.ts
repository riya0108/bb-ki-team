import type { LlmClient } from '@bb/core';
import type { ContentDnaRecord, InstagramFormat } from '@bb/shared-types';
import { InstagramFormatSchema } from '@bb/shared-types';
import { z } from 'zod';

const RoutingDecisionSchema = z.object({
  format: InstagramFormatSchema,
  reasoning: z.string(),
});

// Spec 7.1's routing table, verbatim.
const ROUTING_TABLE = `If the idea is...                                                    Route to
One visual + one clear idea + caption                                Posts
Educational sequence, comparison, list, framework or step-by-step    Carousels
Story, demonstration, opinion, explanation or high-retention narrative  Reels`;

function buildRoutingSystemPrompt(dna: ContentDnaRecord): string {
  return `You are Agent 03 — the Bull or Bear Instagram Content Head Agent (spec section 7). Your
primary responsibility for this idea is deciding which specialist to hire: Posts, Carousels or
Reels. Score the idea against the routing table below and pick exactly one.

${ROUTING_TABLE}

Creator's Content DNA:
- Primary topics: ${dna.topics.primary.join(', ') || 'none noted'}
- Expertise: ${dna.identity.expertise.join(', ') || 'unspecified'}`;
}

export async function routeInstagramFormat(
  topic: string,
  angle: string,
  dna: ContentDnaRecord,
  llm: LlmClient,
  runId: string,
): Promise<InstagramFormat> {
  const response = await llm.completeStructured(
    {
      system: buildRoutingSystemPrompt(dna),
      messages: [{ role: 'user', content: `Topic: ${topic}\nAngle: ${angle}` }],
      runId,
      stepId: 'route-instagram-format',
    },
    RoutingDecisionSchema,
  );
  return response.format;
}
