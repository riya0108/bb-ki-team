import type { BlogStyleProfile, EditorialMemory, StyleSample } from '@bb/shared-types';
import { useEffect, useState } from 'react';

import {
  addStyleReference,
  ApiError,
  getBlogStyleProfile,
  listEditorialMemories,
  removeStyleSample,
  sendEditorialFeedback,
  setEditorialMemory,
} from '../api/client';

const STATUS_CLASS: Record<EditorialMemory['status'], string> = {
  CONFIRMED: 'success',
  INFERRED: '',
  EXPERIMENTAL: '',
  TEMPORARY: '',
  REJECTED: 'cancelled',
};

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
}

// Blog Editorial Memory + Style Profile: what the blog agent has learned about what
// makes a good Bull or Bear article. The editor can confirm or reject each learned
// pattern, give general feedback, and add approved reference articles (only their
// measured style is kept — never their text).
export function EditorialMemoryPanel() {
  const [open, setOpen] = useState(false);
  const [memories, setMemories] = useState<EditorialMemory[]>([]);
  const [profile, setProfile] = useState<BlogStyleProfile | null>(null);
  const [samples, setSamples] = useState<StyleSample[]>([]);
  const [feedback, setFeedback] = useState('');
  const [refLabel, setRefLabel] = useState('');
  const [refSource, setRefSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const [m, p] = await Promise.all([listEditorialMemories(), getBlogStyleProfile()]);
      setMemories(m.memories);
      setProfile(p.profile);
      setSamples(p.samples);
    } catch (err) {
      setError(errorText(err));
    }
  }

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const isUrl = /^https?:\/\//i.test(refSource.trim());

  return (
    <div className="panel reference-library">
      <button type="button" className="reference-library-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="section-label">Editorial memory</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="reference-library-body">
          {error && <div className="error-banner">{error}</div>}

          <div className="reference-section">
            <p className="muted">General feedback for future articles (e.g. “Quizzes feel forced”, “Needs more historical context”).</p>
            <textarea className="draft-textarea" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            <div className="action-row">
              <button
                type="button"
                className="link-button"
                disabled={busy || feedback.trim().length === 0}
                onClick={() => void act(async () => {
                  await sendEditorialFeedback(feedback.trim(), null);
                  setFeedback('');
                })}
              >
                Teach the blog agent
              </button>
            </div>
          </div>

          <div className="reference-section">
            <p className="muted">Learned patterns ({memories.length})</p>
            {memories.length === 0 && <p className="muted">Nothing learned yet — it learns from approvals, edits and feedback.</p>}
            {memories.map((m) => (
              <div key={m.memoryId} className={`activity-log-item ${STATUS_CLASS[m.status]}`}>
                {m.statement}
                <div>
                  {m.status.toLowerCase()} · {m.category} · seen {m.timesConfirmed}×
                  {m.timesRejected > 0 ? ` · contradicted ${m.timesRejected}×` : ''}
                </div>
                <div className="action-row">
                  {m.status !== 'CONFIRMED' && (
                    <button type="button" className="link-button" disabled={busy} onClick={() => void act(() => setEditorialMemory(m.memoryId, 'confirm'))}>
                      Confirm
                    </button>
                  )}
                  {m.status !== 'REJECTED' && (
                    <button type="button" className="link-button" disabled={busy} onClick={() => void act(() => setEditorialMemory(m.memoryId, 'reject'))}>
                      Reject
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="reference-section">
            <p className="muted">
              Style profile: {profile?.ownArticleCount ?? 0} approved article(s), {profile?.referenceCount ?? 0} reference(s).
              {profile?.metrics
                ? ` ~${Math.round(profile.metrics.wordCount)} words, ~${profile.metrics.avgSentenceWords}-word sentences, ${Math.round(profile.metrics.h2Count)} sections.`
                : ''}
            </p>
            {samples
              .filter((s) => s.kind !== 'approved_article')
              .map((s) => (
                <div key={s.id} className="activity-log-item">
                  {s.label} · {s.kind.replace(/_/g, ' ')}
                  <div className="action-row">
                    <button type="button" className="link-button" disabled={busy} onClick={() => void act(() => removeStyleSample(s.id))}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            <input placeholder="Reference label (e.g. INDmoney: UPI explainer)" value={refLabel} onChange={(e) => setRefLabel(e.target.value)} />
            <textarea
              className="draft-textarea"
              rows={3}
              placeholder="Paste an approved reference article's text, or its URL"
              value={refSource}
              onChange={(e) => setRefSource(e.target.value)}
            />
            <div className="action-row">
              <button
                type="button"
                className="link-button"
                disabled={busy || refLabel.trim().length === 0 || refSource.trim().length === 0}
                onClick={() => void act(async () => {
                  await addStyleReference({
                    kind: 'approved_reference',
                    label: refLabel.trim(),
                    source: isUrl ? { kind: 'url', url: refSource.trim() } : { kind: 'text', text: refSource },
                  });
                  setRefLabel('');
                  setRefSource('');
                })}
              >
                {busy ? 'Working…' : '+ Add style reference'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
