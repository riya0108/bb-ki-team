import type { LearningEvent } from '@bb/shared-types';
import { useEffect, useState } from 'react';

import { confirmLearningEvent, getContentDna, listLearningEvents, rejectLearningEvent } from '../api/client';
import { useOperatorName } from '../hooks/useOperatorName';

export function DnaPanel({ refreshToken }: { refreshToken: number }) {
  const [dnaVersion, setDnaVersion] = useState<number | null>(null);
  const [dnaTone, setDnaTone] = useState<string | null>(null);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [operatorName] = useOperatorName();
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getContentDna(), listLearningEvents()])
      .then(([dnaRes, eventsRes]) => {
        if (cancelled) return;
        setDnaVersion(dnaRes.contentDna?.version ?? null);
        setDnaTone(dnaRes.contentDna?.voice.tone ?? null);
        setEvents(eventsRes.events);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken, reloadToken]);

  async function confirm(id: string) {
    await confirmLearningEvent(id, operatorName || 'dashboard-user');
    setReloadToken((t) => t + 1);
  }

  async function reject(id: string) {
    await rejectLearningEvent(id);
    setReloadToken((t) => t + 1);
  }

  return (
    <div className="panel">
      <h2>Content DNA</h2>
      {error && <div className="error-banner">{error}</div>}
      {dnaVersion === null ? (
        <div className="empty-state">No active Content DNA yet.</div>
      ) : (
        <div className="dna-summary">
          Active version {dnaVersion}
          {dnaTone && <div>Tone: {dnaTone}</div>}
        </div>
      )}

      <div className="section-divider" />
      <h2>Learning events</h2>
      {events.length === 0 && <div className="empty-state">No pending signals.</div>}
      {events.map((event) => (
        <div key={event.id} className="learning-event">
          <div>{event.observation}</div>
          <div style={{ color: 'var(--text-dim)' }}>
            {event.source} · {event.strength}
          </div>
          <div className="actions">
            <button onClick={() => void confirm(event.id)}>Confirm</button>
            <button onClick={() => void reject(event.id)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
