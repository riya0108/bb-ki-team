import type { ContentItem } from '@bb/shared-types';
import { useEffect, useState } from 'react';

import {
  ApiError,
  approveContent,
  getContent,
  publishContent,
  rejectContent,
  requestChanges,
  saveManualRevision,
  scheduleContent,
} from '../api/client';
import { useOperatorName } from '../hooks/useOperatorName';
import { ActivityLog } from './ActivityLog';

interface DraftCanvasProps {
  contentId: string | null;
  onChanged: () => void;
}

export function DraftCanvas({ contentId, onChanged }: DraftCanvasProps) {
  const [item, setItem] = useState<ContentItem | null>(null);
  const [text, setText] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useOperatorName();
  // A failed publish/schedule attempt leaves the content item's row (and therefore
  // updatedAt) untouched — only the publish_events table gets a new row — so the
  // activity log needs its own bump on every attempt rather than keying off item state.
  const [activityRefreshToken, setActivityRefreshToken] = useState(0);

  useEffect(() => {
    if (!contentId) {
      setItem(null);
      return;
    }
    let cancelled = false;
    getContent(contentId)
      .then((res) => {
        if (cancelled) return;
        setItem(res.item);
        setText(res.item.currentText);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [contentId]);

  async function reload() {
    if (!contentId) return;
    const res = await getContent(contentId);
    setItem(res.item);
    setText(res.item.currentText);
  }

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      setActivityRefreshToken((t) => t + 1);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!contentId || !item) {
    return null;
  }

  const dirty = text !== item.currentText;
  const htmlFile = item.platform === 'blog' ? item.currentText : null;

  return (
    <div className="draft-area">
      {error && <div className="error-banner">{error}</div>}

      <div className="meta-row">
        <span className={`status-badge ${item.status}`}>{item.status.replace('_', ' ')}</span>
        <span>v{item.currentVersion}</span>
        {item.angle && <span>Angle: {item.angle}</span>}
        {item.approvedBy && <span>Approved by {item.approvedBy}</span>}
      </div>

      <input
        placeholder="Your name (used for approvals/edits)"
        value={operatorName}
        onChange={(e) => setOperatorName(e.target.value)}
        style={{ marginBottom: 10, width: '100%', maxWidth: 320 }}
      />

      {htmlFile ? (
        <>
          <textarea className="draft-textarea" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <div className="action-row">
            <button
              onClick={() =>
                void runAction(() => {
                  const blob = new Blob([text], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  window.open(url, '_blank');
                  return Promise.resolve();
                })
              }
            >
              Preview HTML
            </button>
          </div>
        </>
      ) : (
        <textarea className="draft-textarea" value={text} onChange={(e) => setText(e.target.value)} />
      )}

      <div className="action-row">
        <button
          disabled={busy || !dirty || !operatorName}
          onClick={() => void runAction(() => saveManualRevision(item.id, text, operatorName))}
        >
          Save edit
        </button>
        <button
          className="primary"
          disabled={busy || dirty || item.status !== 'in_review' || !operatorName}
          onClick={() => void runAction(() => approveContent(item.id, item.currentVersion, operatorName))}
        >
          Approve
        </button>
        <button
          disabled={busy || item.status === 'changes_requested'}
          onClick={() => void runAction(() => requestChanges(item.id, 'Changes requested from dashboard.'))}
        >
          Request changes
        </button>
        <button
          className="danger"
          disabled={busy || item.status === 'rejected'}
          onClick={() => void runAction(() => rejectContent(item.id, 'Rejected from dashboard.'))}
        >
          Reject
        </button>
      </div>

      <div className="action-row">
        <button disabled={busy || item.status !== 'approved'} onClick={() => void runAction(() => publishContent(item.id))}>
          Publish
        </button>
        <input
          type="datetime-local"
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
          disabled={item.status !== 'approved'}
        />
        <button
          disabled={busy || item.status !== 'approved' || !scheduledFor}
          onClick={() => void runAction(() => scheduleContent(item.id, new Date(scheduledFor).toISOString()))}
        >
          Schedule
        </button>
      </div>

      <div className="section-divider" />
      <ActivityLog contentId={item.id} refreshToken={activityRefreshToken} />
    </div>
  );
}
