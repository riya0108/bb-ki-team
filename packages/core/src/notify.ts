import type { EmailConfig } from './env.js';
import type { Logger } from './logger.js';

export interface PublishNotification {
  platform: string;
  topic: string | null;
  platformUrl: string | null;
}

// Fire-and-forget by design: called after a PUBLISH_EVENT is already durably
// recorded, so a failed/slow notification must never throw back into the caller's
// publish flow. Callers should await this only to log the outcome, never to gate
// on it. Uses Resend's HTTP API (https://resend.com) — a single POST, no SDK,
// works identically from every runtime that fires a publish, including the
// Deno-based fire-due-schedules Edge Function (which has its own inline copy of
// this call, see supabase/functions/fire-due-schedules/index.ts, since it can't
// import a workspace package).
export async function sendPublishNotification(
  config: EmailConfig,
  notification: PublishNotification,
  logger: Logger,
): Promise<void> {
  const { platform, topic, platformUrl } = notification;
  const subject = `Published to ${platform}${topic ? `: ${topic}` : ''}`;
  const linkHtml = platformUrl
    ? `<p><a href="${platformUrl}">${platformUrl}</a></p>`
    : '<p>(no link was recorded for this publish)</p>';
  const html = `<p>Your scheduled ${platform} post ${topic ? `"${topic}" ` : ''}just went live.</p>${linkHtml}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [config.to],
        subject,
        html,
      }),
    });
    if (!response.ok) {
      logger.error(
        { status: response.status, platform },
        'Resend publish notification email was rejected',
      );
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), platform },
      'Failed to send publish notification email',
    );
  }
}
