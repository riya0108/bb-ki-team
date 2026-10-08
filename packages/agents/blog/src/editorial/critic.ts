import type { LlmClient, Logger } from '@bb/core';
import type { EditorialArchitecture, EditorialBrief, EditorialQuality } from '@bb/shared-types';
import { EDITORIAL_HARD_THRESHOLDS, EditorialQualitySchema, isUsableClaim } from '@bb/shared-types';
import { z } from 'zod';

// Spec 15/25: a dedicated editorial critic that scores the draft 0-10 on fifteen
// dimensions and answers the human-editor test. The model's scores are never the last
// word: deterministic findings set floors/ceilings it cannot talk its way past —
// AI-slop risk is at least the slop filter's score; factual grounding and evidence
// quality are capped by meaning-drift and component-evidence failures and by the
// strength of the brief itself.

const CriticResponseSchema = z.object({
  scores: EditorialQualitySchema,
  humanEditorTest: z.object({
    wouldPublishNextToStrongSubstack: z.boolean(),
    couldCut20PercentWithoutLoss: z.boolean(),
    hasRealThesis: z.boolean(),
    hasPointOfView: z.boolean(),
    teachesSomething: z.boolean(),
    explainsMechanism: z.boolean(),
    conclusionChangesUnderstanding: z.boolean(),
    transitionsNatural: z.boolean(),
  }),
  revisionNotes: z.array(z.string()).max(12).default([]),
  strongestPart: z.string().nullable().default(null),
  weakestPart: z.string().nullable().default(null),
});
export type CriticResponse = z.infer<typeof CriticResponseSchema>;

export interface DeterministicFindings {
  slopRisk: number;
  slopNotes: string[];
  driftIssues: number;
  componentEvidenceIssues: number;
  structureBlocks: string[];
}

export interface CritiqueResult {
  quality: EditorialQuality;
  failures: string[];
  revisionNotes: string[];
  humanEditorTest: CriticResponse['humanEditorTest'];
  strongestPart: string | null;
  weakestPart: string | null;
}

function buildSystemPrompt(): string {
  return `ROLE: blog-editorial-critic
You are the toughest editor at an independent Indian business publication. Score this Bull or Bear
draft 0-10 on: originalityScore, informationDensityScore, factualGroundingScore (every factual
statement maps to a verified claim, nothing overstated), narrativeFlowScore, humanVoiceScore,
clarityScore, depthScore (mechanism, context, counterargument, not just events), curiosityScore,
readerUtilityScore, brandFitScore (sharp, curious, sceptical, evidence-led, independent, practical;
"show them what they are missing"), evidenceQualityScore, counterArgumentScore,
interactiveUsefulnessScore (10 if there are no widgets and none were needed; low if a widget is
decoration), seoQualityScore (findable without SEO-ness), aiSlopRiskScore (0 = reads human, 10 = generic
AI: stock phrases, formulaic rhythm, symmetrical constructions, summary-like paragraphs).
Be strict: 9-10 means it could run next to a strong Substack essay unchanged.
Answer the human editor test honestly. revisionNotes: specific, actionable instructions (which
paragraph, what to change), most important first; never ask for facts outside the verified claims.`;
}

export interface CritiqueInput {
  articleText: string;
  architecture: EditorialArchitecture | null;
  brief: EditorialBrief | null;
  findings: DeterministicFindings;
  llm: LlmClient;
  logger: Logger;
  runId: string;
  stepId: string;
}

// Evidence ceiling from the brief: an article cannot be better evidenced than its research.
export function evidenceCeilingScore(brief: EditorialBrief | null): number {
  if (!brief || brief.kind === 'opinion') return 10;
  if (brief.kind === 'insufficient_evidence') return 3;
  const usable = brief.claims.filter(isUsableClaim);
  if (usable.length === 0) return 3;
  const primaryOrCorroborated = usable.filter((c) => c.verificationStatus === 'VERIFIED').length / usable.length;
  return Math.round((7 + 3 * primaryOrCorroborated) * 10) / 10;
}

export function applyDeterministicBounds(scores: EditorialQuality, findings: DeterministicFindings, brief: EditorialBrief | null): EditorialQuality {
  const factualCap = Math.max(0, 10 - 3 * findings.driftIssues - 2 * findings.componentEvidenceIssues);
  return {
    ...scores,
    aiSlopRiskScore: Math.max(scores.aiSlopRiskScore, findings.slopRisk),
    factualGroundingScore: Math.min(scores.factualGroundingScore, factualCap),
    evidenceQualityScore: Math.min(scores.evidenceQualityScore, evidenceCeilingScore(brief)),
  };
}

export function hardThresholdFailures(quality: EditorialQuality, brief: EditorialBrief | null): string[] {
  const failures: string[] = [];
  for (const t of EDITORIAL_HARD_THRESHOLDS) {
    // An opinion piece has no research to be "evidence quality" about; it is still held
    // to factual grounding (it must not state unverified facts).
    if (t.key === 'evidenceQualityScore' && (!brief || brief.kind === 'opinion')) continue;
    const value = quality[t.key];
    if (t.min !== undefined && value < t.min) failures.push(`${t.key} ${value} < ${t.min}`);
    if (t.max !== undefined && value > t.max) failures.push(`${t.key} ${value} > ${t.max}`);
  }
  return failures;
}

export async function critiqueArticle(input: CritiqueInput): Promise<CritiqueResult | null> {
  const a = input.architecture;
  const plan = a
    ? `Planned thesis: ${a.thesis}\nReader question: ${a.readerQuestion}\nCounterargument to engage: ${a.counterArgument ?? 'none planned'}\nDepth: ${a.articleDepth}`
    : 'No architecture.';
  const claims = (input.brief?.claims ?? [])
    .filter(isUsableClaim)
    .map((c) => `- ${c.id}: ${c.text}`)
    .join('\n');
  const deterministic = [
    input.findings.slopNotes.length > 0 ? `Slop filter: ${input.findings.slopNotes.join(' ')}` : null,
    input.findings.driftIssues > 0 ? `Meaning-drift checker found ${input.findings.driftIssues} distortion(s) of verified facts.` : null,
    input.findings.componentEvidenceIssues > 0 ? `${input.findings.componentEvidenceIssues} component cell(s)/answer(s) are not backed by verified claims.` : null,
    ...input.findings.structureBlocks,
  ].filter((l): l is string => l !== null);

  try {
    const response = await input.llm.completeStructured(
      {
        system: buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: `${plan}

Verified claims (the only facts allowed):
${claims || '(none — opinion/analysis piece)'}

Automated checks already found:
${deterministic.join('\n') || '(nothing)'}

DRAFT:
${input.articleText.slice(0, 24000)}`,
          },
        ],
        runId: input.runId,
        stepId: input.stepId,
        temperature: 0,
        maxTokens: 2000,
      },
      CriticResponseSchema,
    );
    const quality = applyDeterministicBounds(response.scores, input.findings, input.brief);
    const test = response.humanEditorTest;
    const testNotes = [
      !test.hasRealThesis ? 'There is no real thesis yet: make the argument explicit early.' : null,
      !test.explainsMechanism ? 'Explain the mechanism, not just the events.' : null,
      !test.conclusionChangesUnderstanding ? 'The ending must change the reader\'s understanding, not restate it.' : null,
      test.couldCut20PercentWithoutLoss ? 'Cut about 20%: remove paragraphs that tell the reader what they already know.' : null,
      !test.transitionsNatural ? 'Smooth the transitions between sections.' : null,
    ].filter((n): n is string => n !== null);
    return {
      quality,
      failures: hardThresholdFailures(quality, input.brief),
      revisionNotes: [...response.revisionNotes, ...testNotes],
      humanEditorTest: test,
      strongestPart: response.strongestPart,
      weakestPart: response.weakestPart,
    };
  } catch (error) {
    input.logger.warn(
      { runId: input.runId, stepId: input.stepId, err: error instanceof Error ? error.message : String(error) },
      'Editorial critic unavailable',
    );
    return null;
  }
}
