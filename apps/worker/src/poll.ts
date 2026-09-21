import { sendPublishNotification } from '@bb/core';
import { publishDueSchedules } from '@bb/workflows';

import type { WorkerDeps } from './deps.js';

// One poll cycle: fire every scheduled content item whose target time has arrived.
// Each attempt is already logged to the PUBLISH_EVENT ledger by publishDueSchedules
// (spec 15.3/15.4) regardless of outcome — this only adds process-level visibility.
export async function runSchedulerTick(deps: WorkerDeps, asOf: Date = new Date()): Promise<void> {
  const outcomes = await publishDueSchedules(deps.pool, deps.publishConnectors, asOf);

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
      if (deps.email) {
        await sendPublishNotification(
          deps.email,
          { platform: outcome.item.platform, topic: outcome.item.topic, platformUrl: outcome.event.platformUrl },
          deps.logger,
        );
      }
    } else {
      deps.logger.error(
        { contentId: outcome.item.id, platform: outcome.item.platform, error: outcome.event.error },
        'Failed to publish a scheduled content item',
      );
    }
  }
}
