import { runResearchAgent } from '@ai-company/agent-research';
import { runResearchPackAgent } from '@ai-company/agent-research-pack';
import { runTrendResearchAgent } from '@ai-company/agent-trend-research';
import { runWriterAgent } from '@ai-company/agent-writer';
import { runBlogPublisherAgent } from '@ai-company/agent-blog-publisher';
import { runBlogTopicFinderAgent } from '@ai-company/agent-blog-topic-finder';
import { runYoutubeViralFinderAgent } from '@ai-company/agent-youtube-viral-finder';
import { runInstagramViralFinderAgent } from '@ai-company/agent-instagram-viral-finder';
import { runContentStrategyAgent } from '@ai-company/agent-content-strategy';
import { listRecentGateFeedback } from '@ai-company/db';
import {
  BuildResearchPackTaskPayloadSchema,
  FindInstagramSignalsTaskPayloadSchema,
  FindYoutubeSignalsTaskPayloadSchema,
  GatherSignalsTaskPayloadSchema,
  GenerateBlogCandidatesTaskPayloadSchema,
  PublishPostTaskPayloadSchema,
  RunResearchWithTrendsTaskPayloadSchema,
  SynthesizeContentStrategyTaskPayloadSchema,
  WriteDraftTaskPayloadSchema,
  type Task,
} from '@ai-company/shared-types';

/**
 * Maps a claimed task to its agent handler and runs it. Keyed by
 * `${agent}:${taskType}` so each agent can register multiple task types as
 * the workflows grow, without a generic dispatch abstraction.
 */
export async function dispatch(task: Task): Promise<unknown> {
  const key = `${task.agent}:${task.taskType}`;
  switch (key) {
    case 'research:run_research': {
      // Superset schema: trendSignals is present when chained after
      // trend-research, absent for the standalone "research" workflow.
      const payload = RunResearchWithTrendsTaskPayloadSchema.parse(task.payload);
      return runResearchAgent(
        payload.query,
        payload.trendSignals ? { trendSignals: payload.trendSignals } : {},
      );
    }
    case 'trend-research:gather_signals': {
      const payload = GatherSignalsTaskPayloadSchema.parse(task.payload);
      return runTrendResearchAgent(payload.topic);
    }
    case 'research-pack:build_pack': {
      const payload = BuildResearchPackTaskPayloadSchema.parse(task.payload);
      return runResearchPackAgent({
        topic: payload.topic,
        angle: payload.angle,
        ...(payload.modificationNote !== undefined ? { modificationNote: payload.modificationNote } : {}),
      });
    }
    case 'writer:write_draft': {
      const payload = WriteDraftTaskPayloadSchema.parse(task.payload);
      return runWriterAgent(payload);
    }
    case 'blog-publisher:publish_post': {
      const payload = PublishPostTaskPayloadSchema.parse(task.payload);
      return runBlogPublisherAgent(payload);
    }
    case 'blog-topic-finder:generate_candidates': {
      const payload = GenerateBlogCandidatesTaskPayloadSchema.parse(task.payload);
      // "Do Not Recommend" learning (plan §45/46): fetched here, not inside
      // the agent package — agent packages have no DB access, only apps/api
      // and apps/worker do (see CLAUDE.md's task-queue boundary).
      const rejections = await listRecentGateFeedback({
        workflowNames: ['blog', 'content-intelligence'],
        gate: 'topic',
        decision: 'changes_requested',
      });
      const rejectionFeedback = rejections.flatMap((a) => (a.feedback ? [a.feedback] : []));
      return runBlogTopicFinderAgent({
        ...(payload.focusCategory ? { focusCategory: payload.focusCategory } : {}),
        rejectionFeedback,
      });
    }
    case 'youtube-viral-finder:find_youtube_signals': {
      const payload = FindYoutubeSignalsTaskPayloadSchema.parse(task.payload);
      return runYoutubeViralFinderAgent(payload);
    }
    case 'instagram-viral-finder:find_instagram_signals': {
      const payload = FindInstagramSignalsTaskPayloadSchema.parse(task.payload);
      return runInstagramViralFinderAgent(payload);
    }
    case 'content-strategy:synthesize': {
      const payload = SynthesizeContentStrategyTaskPayloadSchema.parse(task.payload);
      return runContentStrategyAgent(payload);
    }
    default:
      throw new Error(`worker: no handler registered for task "${key}"`);
  }
}
