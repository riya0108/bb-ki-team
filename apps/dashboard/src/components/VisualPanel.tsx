import { useEffect, useState } from 'react';

import { ApiError, approveVisual, getVisualAsset, prepareVisual, rejectVisual, uploadVisual } from '../api/client';
import type { PrepareVisualResult } from '../api/client';

interface VisualPanelProps {
  contentId: string;
  version: number;
  onGenerated: () => void;
}

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve({ base64: result.slice(result.indexOf(',') + 1), mimeType: file.type || 'image/png' });
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// The BB Visual Agent (packages/agents/visual) never calls a billed image-gen API
// from this app (see the "Visual Agent: No Paid API" memory) — a human or Claude
// driving a browser session against a free web UI (Gemini/ChatGPT/Google Flow)
// generates the actual pixels. This panel prepares an optional brief + prompt, and
// uploads any image you attach — that upload is stored APPROVED directly (no QA,
// no review step) and goes out with the content when it publishes.
export function VisualPanel({ contentId, version, onGenerated }: VisualPanelProps) {
  const [asset, setAsset] = useState<Awaited<ReturnType<typeof getVisualAsset>>['asset']>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<PrepareVisualResult | null>(null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBrief(null);
    setFile(null);
    getVisualAsset(contentId)
      .then((res) => {
        if (!cancelled) setAsset(res.asset);
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
  }, [contentId]);

  async function handlePrepare() {
    setBusy(true);
    setError(null);
    try {
      const result = await prepareVisual(contentId);
      if (result.terminal) {
        setAsset(result.asset ?? null);
        setBrief(null);
      } else {
        setBrief(result);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAttach() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      const res = await uploadVisual(contentId, base64, mimeType);
      setAsset(res.asset);
      setBrief(null);
      setFile(null);
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      const res = await approveVisual(contentId, asset.id);
      setAsset(res.asset);
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      const res = await rejectVisual(contentId, asset.id, 'Rejected from dashboard.');
      setAsset(res.asset);
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // An approved visual follows the content across text edits (publish attaches the
  // latest approved one — approvedVisual.ts), so it is never shown as stale.
  const isStale = asset !== null && asset.version !== version && asset.status !== 'APPROVED';
  const isReviewable = asset !== null && (asset.status === 'NEEDS_REVIEW' || asset.status === 'QA_PASS');
  const imageUrl = asset?.masterAsset.status === 'STORED' ? asset.masterAsset.assetUrl : null;
  const issues = [...(asset?.blockingReasons ?? []), ...(asset?.qa?.issues ?? [])];

  return (
    <div className="visual-panel">
      <div className="visual-panel-header">
        <span className="section-label">Visual</span>
        {asset && !isStale && (
          <span className={`status-badge visual-${asset.status.toLowerCase()}`}>{asset.status.replace(/_/g, ' ')}</span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {isStale && (
            <p className="muted">
              Existing visual is for v{asset.version}, current draft is v{version} — prepare a new brief to match.
            </p>
          )}
          {imageUrl && !isStale && (
            <img src={imageUrl} alt={asset?.concept ?? 'Generated visual'} className="visual-preview" />
          )}
          {!isStale && issues.length > 0 && (
            <ul className="visual-issues">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}

          {!isStale && isReviewable && (
            <div className="action-row">
              <button disabled={busy} onClick={() => void handleApprove()}>
                {busy ? 'Working…' : 'Approve visual'}
              </button>
              <button disabled={busy} onClick={() => void handleReject()}>
                {busy ? 'Working…' : 'Reject visual'}
              </button>
            </div>
          )}

          {brief && (
            <div className="visual-brief">
              <p className="muted">
                Paste this prompt into a free image-gen web UI (Gemini, ChatGPT, Google Flow) — via Claude-in-Chrome or
                by hand — download the result, then attach it below. Attached images post as-is with the content. Aspect ratio: {brief.aspectRatio}.
              </p>
              <textarea className="draft-textarea visual-prompt-textarea" readOnly value={brief.prompt ?? ''} />
              {brief.negativePrompt && (
                <>
                  <p className="muted">Avoid:</p>
                  <textarea className="draft-textarea visual-prompt-textarea" readOnly value={brief.negativePrompt} />
                </>
              )}
            </div>
          )}

          <div className="action-row">
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button disabled={busy || !file} onClick={() => void handleAttach()}>
              {busy ? 'Attaching…' : asset?.status === 'APPROVED' ? 'Replace visual' : 'Attach visual'}
            </button>
          </div>

          {!brief && (
            <button disabled={busy} onClick={() => void handlePrepare()}>
              {busy ? 'Preparing…' : asset && !isStale ? 'Prepare new visual brief' : 'Prepare visual brief'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
