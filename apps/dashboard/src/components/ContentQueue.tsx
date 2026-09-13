import type { ContentItem, ContentStatus } from '@bb/shared-types';
import { useEffect, useState } from 'react';

import type { Platform } from '../api/client';
import { listContent } from '../api/client';

const STATUS_FILTERS: (ContentStatus | 'all')[] = [
  'all',
  'in_review',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'rejected',
];

interface ContentQueueProps {
  platform: Platform;
  selectedId: string | null;
  onSelect: (id: string) => void;
  refreshToken: number;
}

export function ContentQueue({ platform, selectedId, onSelect, refreshToken }: ContentQueueProps) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [status, setStatus] = useState<ContentStatus | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listContent({ platform, ...(status !== 'all' ? { status } : {}) })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platform, status, refreshToken]);

  return (
    <div className="panel">
      <h2>Content queue</h2>
      <div className="filter-row">
        <select value={status} onChange={(e) => setStatus(e.target.value as ContentStatus | 'all')}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading && items.length === 0 && <div className="empty-state">Loading…</div>}
      {!loading && items.length === 0 && !error && <div className="empty-state">No drafts yet.</div>}
      {items.map((item) => (
        <div
          key={item.id}
          className={`content-item-row${item.id === selectedId ? ' selected' : ''}`}
          onClick={() => onSelect(item.id)}
        >
          <div className="topic">{item.topic ?? '(untitled)'}</div>
          <span className={`status-badge ${item.status}`}>{item.status.replace('_', ' ')}</span>
        </div>
      ))}
    </div>
  );
}
