import type { ContentItem, PublishEvent } from '@bb/shared-types';
import { useEffect, useState } from 'react';

import {
  ApiError,
  approveContent,
  cancelSchedule,
  getContent,
  listPublishEvents,
  modifySchedule,
  publishContent,
  rejectContent,
  requestChanges,
  saveManualRevision,
  scheduleContent,
} from '../api/client';
import { useOperatorName } from '../hooks/useOperatorName';
import { ActivityLog } from './ActivityLog';
import { VisualPanel } from './VisualPanel';

interface DraftCanvasProps {
  contentId: string | null;
  onChanged: () => void;
}

// Mirrors X_MAX_POST_LENGTH in packages/mcp-client/src/xClient.ts — duplicated here
// since the dashboard only depends on @bb/shared-types, not the backend-only
// mcp-client package that owns the real publish-time check.
const X_MAX_POST_LENGTH = 280;

// Reads the saved thread shape (spec 6.1 / tweetsForItem in xClient.ts) back out of
// an X content item so the editor can start from whatever was last saved, whether
// that's a single post or an existing thread.
function postsFromXItem(item: ContentItem): string[] {
  const pkg = item.package as { mode?: string; threadPosts?: unknown } | null;
  if (pkg?.mode === 'thread' && Array.isArray(pkg.threadPosts) && pkg.threadPosts.length > 0) {
    const posts = pkg.threadPosts.filter((post): post is string => typeof post === 'string');
    if (posts.length > 0) return posts;
  }
  return [item.currentText];
}

export function DraftCanvas({ contentId, onChanged }: DraftCanvasProps) {
  const [item, setItem] = useState<ContentItem | null>(null);
  const [text, setText] = useState('');
  // X-only: one entry per tweet in the thread (length 1 == single post). Lets a post
  // that's too long for one tweet be split into a thread right in the dashboard
  // instead of only discovering the 280-char limit as a publish-time error.
  const [posts, setPosts] = useState<string[]>(['']);
  const [scheduledFor, setScheduledFor] = useState('');
  const [modifyScheduledFor, setModifyScheduledFor] = useState('');
  const [events, setEvents] = useState<PublishEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useOperatorName();

  useEffect(() => {
    if (!contentId) {
      setItem(null);
      setEvents([]);
      return;
    }
    let cancelled = false;
    Promise.all([getContent(contentId), listPublishEvents(contentId)])
      .then(([contentRes, eventsRes]) => {
        if (cancelled) return;
        setItem(contentRes.item);
        setText(contentRes.item.currentText);
        setPosts(contentRes.item.platform === 'x' ? postsFromXItem(contentRes.item) : ['']);
        setEvents(eventsRes.events);
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
    const [contentRes, eventsRes] = await Promise.all([getContent(contentId), listPublishEvents(contentId)]);
    setItem(contentRes.item);
    setText(contentRes.item.currentText);
    setPosts(contentRes.item.platform === 'x' ? postsFromXItem(contentRes.item) : ['']);
    setEvents(eventsRes.events);
  }

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
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

  const isX = item.platform === 'x';
  const originalPosts = isX ? postsFromXItem(item) : null;
  const trimmedPosts = posts.map((post) => post.trim()).filter((post) => post.length > 0);
  const xDirty = originalPosts ? JSON.stringify(posts) !== JSON.stringify(originalPosts) : false;
  const dirty = isX ? xDirty : text !== item.currentText;
  const htmlFile = item.platform === 'blog' ? item.currentText : null;
  // The item itself carries no scheduled-time column (spec 15's ledger is the only
  // source of truth for that) — the active schedule is whichever schedule attempt
  // most recently succeeded, per the same "latest success wins" rule apps/worker's
  // listDueSchedules applies (a reschedule supersedes the original by inserting a
  // newer row, never by mutating it).
  const activeSchedule =
    item.status === 'scheduled' ? (events.find((e) => e.result === 'success' && e.scheduledFor)?.scheduledFor ?? null) : null;

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
      ) : isX ? (
        <div className="thread-editor">
          {posts.map((post, i) => (
            <div className="thread-post" key={i}>
              <textarea
                className="draft-textarea thread-post-textarea"
                value={post}
                placeholder={i === 0 ? 'First post (must work standalone)' : `Post ${i + 1}`}
                onChange={(e) => {
                  const next = [...posts];
                  next[i] = e.target.value;
                  setPosts(next);
                }}
              />
              <div className="thread-post-footer">
                <span className={`char-count ${post.length > X_MAX_POST_LENGTH ? 'over' : ''}`}>
                  {post.length}/{X_MAX_POST_LENGTH}
                </span>
                {posts.length > 1 && (
                  <button className="link-button danger" onClick={() => setPosts(posts.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          <button className="link-button" onClick={() => setPosts([...posts, ''])}>
            + Add post to thread
          </button>
        </div>
      ) : (
        <textarea className="draft-textarea" value={text} onChange={(e) => setText(e.target.value)} />
      )}

      <VisualPanel
        contentId={item.id}
        version={item.currentVersion}
        onGenerated={() => {
          void reload();
          onChanged();
        }}
      />

      <div className="action-row">
        <button
          disabled={
            busy ||
            !dirty ||
            !operatorName ||
            (isX ? trimmedPosts.length === 0 || posts.some((post) => post.length > X_MAX_POST_LENGTH) : false)
          }
          title={
            !operatorName
              ? 'Enter your name above first'
              : !dirty
                ? 'No changes to save'
                : isX && posts.some((post) => post.length > X_MAX_POST_LENGTH)
                  ? 'A post in the thread is over the character limit'
                  : undefined
          }
          onClick={() =>
            void runAction(() =>
              isX
                ? saveManualRevision(item.id, trimmedPosts[0] ?? '', operatorName, trimmedPosts.length > 1 ? trimmedPosts : null)
                : saveManualRevision(item.id, text, operatorName),
            )
          }
        >
          Save edit
        </button>
        <button
          className="primary"
          disabled={busy || dirty || item.status !== 'in_review' || !operatorName}
          title={
            !operatorName
              ? 'Enter your name above first'
              : dirty
                ? 'Save or discard your edit first'
                : item.status !== 'in_review'
                  ? `Cannot approve from status "${item.status.replace('_', ' ')}"`
                  : undefined
          }
          onClick={() => void runAction(() => approveContent(item.id, item.currentVersion, operatorName))}
        >
          Approve
        </button>
        <button
          disabled={busy || dirty || item.status === 'changes_requested'}
          title={dirty ? 'Save or discard your edit first' : undefined}
          onClick={() => void runAction(() => requestChanges(item.id, 'Changes requested from dashboard.'))}
        >
          Request changes
        </button>
        <button
          className="danger"
          disabled={busy || dirty || item.status === 'rejected'}
          title={dirty ? 'Save or discard your edit first' : undefined}
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

      {item.status === 'scheduled' && (
        <div className="action-row">
          <span className="schedule-status-note">
            {activeSchedule ? `Scheduled for ${new Date(activeSchedule).toLocaleString()}` : 'Scheduled'}
          </span>
          <input
            type="datetime-local"
            value={modifyScheduledFor}
            onChange={(e) => setModifyScheduledFor(e.target.value)}
          />
          <button
            disabled={busy || !modifyScheduledFor}
            onClick={() =>
              void runAction(() => modifySchedule(item.id, new Date(modifyScheduledFor).toISOString()))
            }
          >
            Modify schedule
          </button>
          <button className="danger" disabled={busy} onClick={() => void runAction(() => cancelSchedule(item.id))}>
            Cancel schedule
          </button>
        </div>
      )}

      <div className="section-divider" />
      <ActivityLog events={events} />
    </div>
  );
}
