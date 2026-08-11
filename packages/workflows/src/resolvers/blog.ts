import {
  BuildResearchPackTaskPayloadSchema,
  ResearchPackSchema,
  WriteDraftTaskPayloadSchema,
} from '@ai-company/shared-types';
import type { NextStepResolver } from '../steps.js';

/**
 * blog's auto-chain resolvers. `run_research` and `write_draft` are
 * deliberately absent — they're approval gates (see gates.ts), resolved by a
 * human decision via approvalResolvers.ts instead of auto-chaining here.
 */
export const BLOG_RESOLVERS: Record<string, NextStepResolver> = {
  build_pack: (result, originalPayload) => {
    const researchPack = ResearchPackSchema.parse(result);
    const { topic, modificationNote } = BuildResearchPackTaskPayloadSchema.parse(originalPayload);
    return {
      agent: 'writer',
      taskType: 'write_draft',
      payload: WriteDraftTaskPayloadSchema.parse({
        topic,
        researchPack,
        ...(modificationNote ? { modificationNote } : {}),
      }),
    };
  },
  publish_post: () => undefined,
};
