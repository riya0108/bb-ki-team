import type { Claim, ContentItem, EditorialBrief, QaDimensionResult, QaResult } from '@bb/shared-types';
import { useEffect, useState } from 'react';

import { getContentQa } from '../api/client';

interface EditorialPanelProps {
  item: ContentItem;
}

const USABLE = new Set(['VERIFIED', 'HIGH_CONFIDENCE']);

const DIMENSION_LABELS: Record<string, string> = {
  claimCoverage: 'Key facts covered',
  claimTraceability: 'Claims traceable',
  meaningPreservation: 'Meaning preserved',
  temporalAccuracy: 'Temporal accuracy',
  entityAccuracy: 'Entities',
  numberAccuracy: 'Numbers & units',
  attributionAccuracy: 'Attribution & quotes',
  causalityAccuracy: 'Causality',
  hookTraceability: 'Hook traceable',
  crossPlatformConsistency: 'Cross-platform consistency',
  editorial_critic: 'Editorial critic',
  ai_slop: 'AI-slop filter',
  meaning_drift: 'Meaning drift',
  structure: 'Structure',
  interactive_components: 'Interactive components',
  html: 'HTML',
  seo: 'SEO',
  internal_links: 'Internal links',
  reader_value: 'Reader value',
};

const KIND_LABELS: Record<EditorialBrief['kind'], string> = {
  researched: 'Researched & verified',
  insufficient_evidence: 'Insufficient evidence — check every fact manually',
  opinion: 'Opinion / analysis — no research run',
};

// The brief is written server-side by the editorial pipeline and stored inside the
// item's package; only the shape check needed to render it safely happens here.
function briefOf(item: ContentItem): EditorialBrief | null {
  const candidate = (item.package as { editorialBrief?: unknown } | null)?.editorialBrief;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const brief = candidate as Partial<EditorialBrief>;
  return typeof brief.id === 'string' && Array.isArray(brief.claims) ? (brief as EditorialBrief) : null;
}

function isDimension(value: unknown): value is QaDimensionResult {
  return typeof value === 'object' && value !== null && 'status' in value && 'notes' in value;
}

// Spec 49/50: make human review better by showing what the story is, why this angle
// and hook were chosen, which verified facts support it, what is uncertain, and every
// fact/meaning QA flag for the exact version being approved.
export function EditorialPanel({ item }: EditorialPanelProps) {
  const [qa, setQa] = useState<QaResult | null>(null);
  const brief = briefOf(item);

  useEffect(() => {
    let cancelled = false;
    getContentQa(item.id)
      .then((res) => {
        if (!cancelled) setQa(res.qa);
      })
      .catch(() => {
        if (!cancelled) setQa(null);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.currentVersion]);

  if (!brief) return null;

  const byId = new Map(brief.claims.map((c) => [c.id, c]));
  const keyFacts = brief.keyFactClaimIds.map((id) => byId.get(id)).filter((c): c is Claim => c !== undefined);
  const uncertain = brief.claims.filter((c) => !USABLE.has(c.verificationStatus));
  const protectedIds = new Set(brief.protectedClaimIds);
  const rejectedHooks = brief.hookCandidates.filter((h) => h.rejected).length;
  const sources = brief.sources.filter((s) => s.tier !== 'discovery' && s.url);
  const flags = [
    ...(qa?.editorial
      ? Object.entries(qa.editorial).filter(
          (entry): entry is [string, QaDimensionResult] => isDimension(entry[1]) && entry[1].status !== 'PASS',
        )
      : []),
    // Platform-specific gates (e.g. the Blog agent's critic, AI-slop, component and HTML checks).
    ...Object.entries(qa?.platformChecks ?? {}).filter(([, dim]) => dim.status !== 'PASS'),
  ];

  return (
    <div className="editorial-panel">
      <div className="section-divider" />
      <h2>Editorial brief</h2>
      <div className={`editorial-kind ${brief.kind}`}>{KIND_LABELS[brief.kind]}</div>

      {brief.storyEssence && (
        <div className="editorial-block">
          <div className="editorial-label">Story</div>
          <div>{brief.storyEssence.event}</div>
          <div className="editorial-dim">{brief.storyEssence.whyItMatters}</div>
        </div>
      )}

      {brief.selectedAngle && (
        <div className="editorial-block">
          <div className="editorial-label">Angle</div>
          <div>{brief.selectedAngle.angle}</div>
          <div className="editorial-dim">{brief.selectedAngle.rationale}</div>
        </div>
      )}

      {brief.selectedHooks[0] && (
        <div className="editorial-block">
          <div className="editorial-label">Chosen hook</div>
          <div>{brief.selectedHooks[0].text}</div>
          <div className="editorial-dim">
            Rests on {brief.selectedHooks[0].supportingClaimIds.join(', ')}
            {rejectedHooks > 0 ? ` · ${rejectedHooks} candidate hook(s) rejected by the fact/meaning gates` : ''}
          </div>
        </div>
      )}

      {keyFacts.length > 0 && (
        <div className="editorial-block">
          <div className="editorial-label">Verified key facts</div>
          {keyFacts.map((c) => (
            <div key={c.id} className="activity-log-item success">
              {c.text}
              <div>
                {c.id} · {c.verificationStatus}
                {protectedIds.has(c.id) ? ' · protected: meaning must not change' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {uncertain.length > 0 && (
        <div className="editorial-block">
          <div className="editorial-label">Not verified — must not be stated as fact</div>
          {uncertain.map((c) => (
            <div key={c.id} className="activity-log-item cancelled">
              {c.text}
              <div>
                {c.id} · {c.verificationStatus}
                {c.notes ? ` · ${c.notes}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {qa && (
        <div className="editorial-block">
          <div className="editorial-label">QA for this version: {qa.overallStatus}</div>
          {qa.editorial === undefined && <div className="editorial-dim">No fact/meaning checks for this version.</div>}
          {qa.editorial !== undefined && flags.length === 0 && (
            <div className="editorial-dim">All fact/meaning checks passed.</div>
          )}
          {flags.map(([name, dim]) => (
            <div key={name} className={`activity-log-item ${dim.status === 'FAIL' ? 'failed' : 'cancelled'}`}>
              {DIMENSION_LABELS[name] ?? name}: {dim.status} — {dim.notes}
              {(dim.evidence ?? []).slice(0, 3).map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div className="editorial-block">
          <div className="editorial-label">Sources</div>
          {sources.map((s) => (
            <div key={s.id}>
              <a className="html-preview-link" href={s.url ?? undefined} target="_blank" rel="noreferrer">
                {s.publisher ?? s.url} {s.title ? `— ${s.title}` : ''}
              </a>{' '}
              <span className="editorial-dim">({s.tier})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
