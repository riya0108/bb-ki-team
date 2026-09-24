import type { VisualReferenceAsset, VisualReferenceKind } from '@bb/shared-types';
import { useEffect, useState } from 'react';

import { ApiError, deleteReference, listReferences, uploadReference } from '../api/client';

interface ReferenceLibraryProps {
  platform: string;
}

const SECTIONS: { kind: VisualReferenceKind; title: string; hint: string }[] = [
  {
    kind: 'character',
    title: 'Character',
    hint: 'Photos of the same person in different poses/expressions, for identity consistency across thumbnails.',
  },
  {
    kind: 'thumbnail_style',
    title: 'Thumbnail style',
    hint: 'Example thumbnails to match art direction, mood, and color grading.',
  },
];

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

// Persistent reference images for the blog visual agent (see the "Visual" panel in
// DraftCanvas) — uploaded here once, then reused across every future thumbnail
// generation until removed. This library only feeds the manual/browser-driven
// generation step; it never triggers a generation itself.
export function ReferenceLibrary({ platform }: ReferenceLibraryProps) {
  const [refs, setRefs] = useState<VisualReferenceAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<VisualReferenceKind, string>>({
    character: '',
    thumbnail_style: '',
  });
  const [open, setOpen] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await listReferences(platform);
      setRefs(res.references);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [platform]);

  async function handleUpload(kind: VisualReferenceKind, file: File) {
    setBusy(true);
    setError(null);
    try {
      const { base64, mimeType } = await fileToBase64(file);
      await uploadReference(platform, kind, labels[kind].trim() || null, base64, mimeType);
      setLabels((l) => ({ ...l, [kind]: '' }));
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteReference(id);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel reference-library">
      <button type="button" className="reference-library-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="section-label">Visual references</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="reference-library-body">
          {error && <div className="error-banner">{error}</div>}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            SECTIONS.map((section) => {
              const items = refs.filter((r) => r.kind === section.kind);
              return (
                <div key={section.kind} className="reference-section">
                  <p className="muted">{section.hint}</p>
                  {items.length > 0 && (
                    <div className="reference-grid">
                      {items.map((item) => (
                        <div className="reference-thumb" key={item.id}>
                          <img src={item.assetUrl} alt={item.label ?? section.title} />
                          <button
                            type="button"
                            className="reference-thumb-remove"
                            disabled={busy}
                            onClick={() => void handleDelete(item.id)}
                            aria-label="Remove reference"
                          >
                            ×
                          </button>
                          {item.label && <span className="reference-thumb-label">{item.label}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="action-row">
                    <input
                      placeholder="Label (optional)"
                      value={labels[section.kind]}
                      onChange={(e) => setLabels((l) => ({ ...l, [section.kind]: e.target.value }))}
                    />
                    <label className="link-button reference-upload-label">
                      {busy ? 'Uploading…' : `+ Add ${section.title.toLowerCase()}`}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={busy}
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUpload(section.kind, file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
