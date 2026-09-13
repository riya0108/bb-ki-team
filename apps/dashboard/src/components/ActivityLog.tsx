import type { PublishEvent } from '@bb/shared-types';
import { useEffect, useState } from 'react';

import { listPublishEvents } from '../api/client';

interface ActivityLogProps {
  contentId: string;
  refreshToken: number;
}

export function ActivityLog({ contentId, refreshToken }: ActivityLogProps) {
  const [events, setEvents] = useState<PublishEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    listPublishEvents(contentId)
      .then((res) => {
        if (!cancelled) setEvents(res.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [contentId, refreshToken]);

  if (events.length === 0) {
    return (
      <div>
        <h2>Activity log</h2>
        <div className="empty-state">No publish/schedule attempts yet.</div>
      </div>
    );
  }

  return (
    <div>
      <h2>Activity log</h2>
      {events.map((event) => (
        <div key={event.id} className={`activity-log-item ${event.result}`}>
          <div>
            {event.scheduledFor ? 'Schedule' : 'Publish'} via {event.connector} — {event.result}
          </div>
          {event.error && <div>{event.error}</div>}
          {event.platformUrl && (
            <a className="html-preview-link" href={event.platformUrl} target="_blank" rel="noreferrer">
              {event.platformUrl}
            </a>
          )}
          <div>{new Date(event.createdAt).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
