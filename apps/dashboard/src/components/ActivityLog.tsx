import type { PublishEvent } from '@bb/shared-types';

interface ActivityLogProps {
  events: PublishEvent[];
}

export function ActivityLog({ events }: ActivityLogProps) {
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
          {event.scheduledFor && (
            <div className="activity-log-scheduled-for">
              Scheduled for {new Date(event.scheduledFor).toLocaleString()}
            </div>
          )}
          {event.error && <div>{event.error}</div>}
          {event.platformUrl && (
            <a className="html-preview-link" href={event.platformUrl} target="_blank" rel="noreferrer">
              {event.platformUrl}
            </a>
          )}
          <div>Logged {new Date(event.createdAt).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
