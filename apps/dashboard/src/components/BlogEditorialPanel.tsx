import type {
  ComponentDecision,
  ContentItem,
  CoverageCheck,
  EditorialArchitecture,
  EditorialBrief,
  EditorialQuality,
  EditorialWarning,
  InternalLink,
} from '@bb/shared-types';
import { EDITORIAL_HARD_THRESHOLDS } from '@bb/shared-types/editorial-thresholds';

interface BlogEditorialPanelProps {
  item: ContentItem;
}

// The blog agent stores its editorial reasoning in the item's package (see
// packages/agents/blog/src/headAgent.ts). Only the shape checks needed to render it
// safely happen here; anything missing simply isn't shown (older drafts).
interface BlogPackageView {
  editorialArchitecture?: EditorialArchitecture | null;
  editorialQuality?: EditorialQuality | null;
  editorialWarnings?: EditorialWarning[];
  internalLinks?: InternalLink[];
  coverage?: CoverageCheck | null;
  editorialBrief?: EditorialBrief;
}

function viewOf(item: ContentItem): BlogPackageView {
  const pkg = item.package as BlogPackageView | null;
  return pkg ?? {};
}

const SCORE_LABELS: Record<keyof EditorialQuality, string> = {
  originalityScore: 'Originality',
  informationDensityScore: 'Information density',
  factualGroundingScore: 'Factual grounding',
  narrativeFlowScore: 'Narrative flow',
  humanVoiceScore: 'Human voice',
  clarityScore: 'Clarity',
  depthScore: 'Depth',
  curiosityScore: 'Curiosity',
  readerUtilityScore: 'Reader usefulness',
  brandFitScore: 'Brand fit',
  evidenceQualityScore: 'Evidence quality',
  counterArgumentScore: 'Counterargument',
  interactiveUsefulnessScore: 'Interactive usefulness',
  seoQualityScore: 'SEO (without SEO-ness)',
  aiSlopRiskScore: 'AI-slop risk (lower is better)',
};

function thresholdFor(key: keyof EditorialQuality): { min?: number; max?: number } | undefined {
  return EDITORIAL_HARD_THRESHOLDS.find((t) => t.key === key);
}

function scoreClass(key: keyof EditorialQuality, value: number): string {
  const t = thresholdFor(key);
  if (!t) return '';
  if ((t.min !== undefined && value < t.min) || (t.max !== undefined && value > t.max)) return 'failed';
  return 'success';
}

function SourceQuality({ brief }: { brief: EditorialBrief }) {
  const tiers = brief.sources.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.tier]: (acc[s.tier] ?? 0) + 1 }), {});
  const syndicated = (brief.research.syndicatedGroups ?? []).length;
  const counterQueries = brief.research.counterEvidenceQueries ?? [];
  return (
    <div className="editorial-block">
      <div className="editorial-label">Research & source quality</div>
      <div>
        {brief.research.documentsUsed} documents used of {brief.research.documentsConsidered} considered ·{' '}
        {Object.entries(tiers)
          .map(([tier, n]) => `${n} ${tier}`)
          .join(', ')}
      </div>
      {counterQueries.length > 0 && <div className="editorial-dim">Counter-evidence searched: {counterQueries.join(' · ')}</div>}
      {syndicated > 0 && (
        <div className="editorial-dim">
          {syndicated} group(s) of syndicated/copied reports counted as one source each.
        </div>
      )}
      {brief.storyEssence?.strongestCounterargument && (
        <div className="editorial-dim">Strongest counterargument found: {brief.storyEssence.strongestCounterargument}</div>
      )}
    </div>
  );
}

function ComponentList({ decisions }: { decisions: ComponentDecision[] }) {
  if (decisions.length === 0) return <div className="editorial-dim">No components were proposed — plain prose was the right call.</div>;
  return (
    <>
      {decisions.map((d) => (
        <div key={d.type} className={`activity-log-item ${d.decision === 'USE' ? 'success' : 'cancelled'}`}>
          {d.decision === 'USE' ? 'Used' : 'Not used'}: {d.type} (score {d.total})
          <div>{d.purpose}</div>
          <div>{d.reason}</div>
        </div>
      ))}
    </>
  );
}

// Spec 44: "Why did the agent write this article this way?" — the thesis, angle,
// structure, critic scores, component decisions and warnings, as concise editorial
// rationale (never internal chain-of-thought).
export function BlogEditorialPanel({ item }: BlogEditorialPanelProps) {
  if (item.platform !== 'blog') return null;
  const view = viewOf(item);
  const a = view.editorialArchitecture ?? null;
  const q = view.editorialQuality ?? null;
  const warnings = view.editorialWarnings ?? [];
  const links = view.internalLinks ?? [];
  if (!a && !q && warnings.length === 0) return null;

  const blocking = warnings.filter((w) => w.severity === 'block');
  const other = warnings.filter((w) => w.severity !== 'block');

  return (
    <div className="editorial-panel">
      <div className="section-divider" />
      <h2>Why this article is written this way</h2>

      {(blocking.length > 0 || other.length > 0) && (
        <div className="editorial-block">
          <div className="editorial-label">Editorial warnings</div>
          {blocking.map((w, i) => (
            <div key={`b-${i}`} className="activity-log-item failed">
              {w.message}
            </div>
          ))}
          {other.map((w, i) => (
            <div key={`w-${i}`} className="activity-log-item cancelled">
              {w.message}
            </div>
          ))}
        </div>
      )}

      {a && (
        <>
          <div className="editorial-block">
            <div className="editorial-label">Thesis</div>
            <div>{a.thesis}</div>
            <div className="editorial-dim">
              Angle: {a.primaryAngle}
              {a.secondaryAngle ? ` · Secondary: ${a.secondaryAngle}` : ''}
            </div>
            <div className="editorial-dim">Reader question: {a.readerQuestion}</div>
          </div>
          {(a.hiddenMechanism ?? a.counterArgument) && (
            <div className="editorial-block">
              <div className="editorial-label">Mechanism & counterargument</div>
              {a.hiddenMechanism && <div>Mechanism: {a.hiddenMechanism}</div>}
              {a.counterArgument && <div className="editorial-dim">Counterargument: {a.counterArgument}</div>}
              {a.bullCase && <div className="editorial-dim">Bull case: {a.bullCase}</div>}
              {a.bearCase && <div className="editorial-dim">Bear case: {a.bearCase}</div>}
              {a.whatWeDontKnow.length > 0 && <div className="editorial-dim">Unknowns: {a.whatWeDontKnow.join('; ')}</div>}
            </div>
          )}
          <div className="editorial-block">
            <div className="editorial-label">
              Structure · {a.articleDepth.replace(/_/g, ' ')} ({a.targetWordRange[0]}–{a.targetWordRange[1]} words)
              {a.source === 'fallback' ? ' · planner unavailable, conservative plan used' : ''}
            </div>
            {a.sectionPlan.map((s, i) => (
              <div key={i} className="editorial-dim">
                {i + 1}. [{s.role.replace(/_/g, ' ')}] {s.headingIdea}
              </div>
            ))}
            {a.mustNotClaim.length > 0 && <div className="editorial-dim">Must not claim: {a.mustNotClaim.join('; ')}</div>}
          </div>
          <div className="editorial-block">
            <div className="editorial-label">Interactive components</div>
            <ComponentList decisions={a.componentDecisions} />
          </div>
        </>
      )}

      {q && (
        <div className="editorial-block">
          <div className="editorial-label">Editorial critic scores (0–10; hard thresholds marked)</div>
          {(Object.keys(SCORE_LABELS) as (keyof EditorialQuality)[]).map((key) => {
            const t = thresholdFor(key);
            return (
              <div key={key} className={`activity-log-item ${scoreClass(key, q[key])}`}>
                {SCORE_LABELS[key]}: {q[key]}
                {t ? ` (needs ${t.min !== undefined ? `≥ ${t.min}` : `≤ ${t.max ?? ''}`})` : ''}
              </div>
            );
          })}
        </div>
      )}

      {view.editorialBrief && view.editorialBrief.kind !== 'opinion' && <SourceQuality brief={view.editorialBrief} />}

      {view.coverage && view.coverage.matches.length > 0 && (
        <div className="editorial-block">
          <div className="editorial-label">Previously covered</div>
          {view.coverage.matches.map((m) => (
            <div key={m.contentId} className="editorial-dim">
              “{m.title}” · {m.status} · similarity {m.similarity}
            </div>
          ))}
          {a && <div className="editorial-dim">Planner decision: {a.priorCoverageDecision.replace(/_/g, ' ')}</div>}
        </div>
      )}

      {links.length > 0 && (
        <div className="editorial-block">
          <div className="editorial-label">Internal links</div>
          {links.map((l) => (
            <div key={l.targetContentId} className="editorial-dim">
              “{l.anchorText}” → {l.targetTitle} ({l.reason})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
