import { publishDueSchedules } from '@bb/workflows';
import { Router } from 'express';

import type { AppDeps } from '../deps.js';

// Free-tier stand-in for a persistent apps/worker process (see apps/worker/src/poll.ts):
// Render's free plan only allows "web service" instances, not a background worker, so
// there is nowhere to run a real setInterval loop for free. Instead, a Supabase pg_cron
// job (alongside the one already driving supabase/functions/fire-due-schedules for
// platform "blog") calls this endpoint once a minute to do the same job apps/worker's
// loop would have done, scoped to "x" only.
//
// Deliberately never includes deps.publishConnectors.blog even though it may be present
// in local dev — platform "blog" schedules are fired by the Supabase edge function, and
// firing them here too would race it to publish the same due item twice (same reasoning
// as apps/worker/src/deps.ts's comment on why it never registers a blog connector).
export function createSchedulerRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/tick', async (_req, res) => {
    const connectors = deps.publishConnectors.x ? { x: deps.publishConnectors.x } : {};
    const outcomes = await publishDueSchedules(deps.pool, connectors, new Date());

    for (const outcome of outcomes) {
      if (outcome.event.result === 'success') {
        deps.logger.info(
          {
            contentId: outcome.item.id,
            platform: outcome.item.platform,
            platformUrl: outcome.event.platformUrl,
          },
          'Published a scheduled content item',
        );
      } else {
        deps.logger.error(
          { contentId: outcome.item.id, platform: outcome.item.platform, error: outcome.event.error },
          'Failed to publish a scheduled content item',
        );
      }
    }

    res.status(200).json({
      checked: outcomes.length,
      results: outcomes.map((outcome) => ({
        contentId: outcome.item.id,
        platform: outcome.item.platform,
        result: outcome.event.result,
      })),
    });
  });

  return router;
}
