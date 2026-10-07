import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { Claim, ContentDnaRecord, EditorialAngle, StoryEssence, UserRequestAnalysis } from '@bb/shared-types';
import { EditorialAngleSchema, isUsableClaim, RankedFactSchema, StoryEssenceSchema } from '@bb/shared-types';
import { z } from 'zod';

// Spec 14/15/16/60: "Why is this worth attention?" — rank verified facts by editorial
// importance (the first fact research found is not necessarily the most interesting),
// identify novelty/consequence/mechanism/tension, and propose 3-5 truthful angles.
// One LLM call covers significance + angle generation (spec 46: combine compatible
// reasoning steps); angle *selection* is deterministic (selectAngles.ts).

const SignificanceResponseSchema = z.object({
  essence: StoryEssenceSchema.omit({ rankedFacts: true, editorialAngles: true, recommendedAngleId: true }),
  rankedFacts: z.array(RankedFactSchema).min(1),
  angles: z.array(EditorialAngleSchema.omit({ id: true })).min(1).max(5),
  recommendedAngleIndex: z.number().int().min(0).nullable().default(null),
  thingsNotToSay: z.array(z.string()).default([]),
  uncertaintyNotes: z.array(z.string()).default([]),
  temporalNotes: z.array(z.string()).default([]),
});

export interface SignificanceResult {
  essence: StoryEssence;
  rankedClaims: Claim[];
  thingsNotToSay: string[];
  uncertaintyNotes: string[];
  temporalNotes: string[];
}

function describeClaim(c: Claim): string {
  return `- ${c.id} [${c.type}, ${c.verificationStatus}, temporal ${c.temporalContext.status}${c.temporalContext.qualifier ? ` "${c.temporalContext.qualifier}"` : ''}${c.mustPreserve ? ', MUST PRESERVE' : ''}] ${c.text}`;
}

function buildSystemPrompt(dna: ContentDnaRecord): string {
  return `ROLE: editorial-significance-analyst
You are the editorial strategist for Bull or Bear. You do NOT write the post. You decide what makes
this story worth reading, using ONLY the verified claims supplied.

Brand positioning: ${BRAND_BRAIN.positioning.description}
Editorial lens:
${BRAND_BRAIN.positioning.editorialLens.map((l) => `- ${l}`).join('\n')}
Audience: ${dna.identity.audiencePrimary}

Rules:
- Rank facts by editorial importance (novelty, consequence, scale, affected audience, surprise,
  tension, implications). A "first since X" or a direct reader consequence usually outranks a
  technical mechanic. The first fact listed is not automatically the most important.
- Every field of the essence must be derivable from the verified claims. Never add facts, numbers,
  causes or motives. Use null when the claims don't support a field.
- mostImportantFactClaimId / mostInterestingFactClaimId must be IDs of usable (VERIFIED or
  HIGH_CONFIDENCE) claims.
- Propose 3-5 genuinely different angles, each built only on usable claim IDs. emotionalMode must
  emerge from the story itself; never manufacture fear, outrage or urgency for engagement.
  Score relevance, novelty, readerImpact, curiosity, brandFit 0-10. matchesUserIntent = true only
  for an angle that delivers what the user explicitly asked for.
- thingsNotToSay: short phrases a writer might be tempted to use that would distort a protected
  fact (e.g. "rate hike again" for a first-since fact, "has imposed" for a proposal).
- uncertaintyNotes: what is not established. temporalNotes: how time-sensitive facts must be phrased.`;
}

function buildUserPrompt(topic: string, claims: readonly Claim[], userRequest: UserRequestAnalysis): string {
  const usable = claims.filter(isUsableClaim);
  const unusable = claims.filter((c) => !isUsableClaim(c));
  return `Topic: ${topic}
User's editorial intent: ${userRequest.editorialIntent.join('; ') || 'none stated'}
User's angle requests: ${userRequest.angleRequests.join('; ') || 'none stated'}

Usable claims (build only on these):
${usable.map(describeClaim).join('\n') || '(none)'}

NOT usable — unverified/disputed (never build an angle on these; mention only as uncertainty):
${unusable.map(describeClaim).join('\n') || '(none)'}`;
}

export interface AnalyzeSignificanceInput {
  topic: string;
  claims: readonly Claim[];
  userRequest: UserRequestAnalysis;
  contentDna: ContentDnaRecord;
  llm: LlmClient;
  runId: string;
}

export async function analyzeSignificance(input: AnalyzeSignificanceInput): Promise<SignificanceResult> {
  const response = await input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna),
      messages: [{ role: 'user', content: buildUserPrompt(input.topic, input.claims, input.userRequest) }],
      runId: input.runId,
      stepId: 'editorial-significance',
      temperature: 0.3,
      maxTokens: 4096,
    },
    SignificanceResponseSchema,
  );
  return reconcileSignificance(input.claims, response);
}

// Validate the model's output against the ledger: unknown IDs dropped, angles left with
// no usable support dropped, "most important fact" forced onto a usable claim, and
// claim importance/mustPreserve updated from the ranking.
export function reconcileSignificance(
  claims: readonly Claim[],
  response: z.infer<typeof SignificanceResponseSchema>,
): SignificanceResult {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const usableIds = new Set(claims.filter(isUsableClaim).map((c) => c.id));

  const rankedFacts = response.rankedFacts.filter((r) => byId.has(r.claimId));
  const importanceById = new Map(rankedFacts.map((r) => [r.claimId, r.importance]));
  const topUsable = [...rankedFacts].sort((a, b) => b.importance - a.importance).find((r) => usableIds.has(r.claimId))?.claimId
    ?? [...claims].filter(isUsableClaim).sort((a, b) => b.importance - a.importance)[0]?.id;
  if (!topUsable) throw new Error('analyzeSignificance: no usable claims to build a story essence from');

  const angles: EditorialAngle[] = response.angles
    .map((a, i) => ({ ...a, id: `angle_${i + 1}`, supportingClaimIds: a.supportingClaimIds.filter((id) => byId.has(id)) }))
    .filter((a) => a.supportingClaimIds.some((id) => usableIds.has(id)));

  const pick = (id: string): string => (usableIds.has(id) ? id : topUsable);
  const recommended =
    response.recommendedAngleIndex !== null ? angles.find((a) => a.id === `angle_${(response.recommendedAngleIndex ?? 0) + 1}`) : undefined;

  const essence: StoryEssence = StoryEssenceSchema.parse({
    ...response.essence,
    mostImportantFactClaimId: pick(response.essence.mostImportantFactClaimId),
    mostInterestingFactClaimId: pick(response.essence.mostInterestingFactClaimId),
    rankedFacts,
    editorialAngles: angles,
    recommendedAngleId: recommended?.id ?? null,
  });

  const rankedClaims = claims.map((c) => {
    const importance = importanceById.get(c.id) ?? c.importance;
    const criticalTemporal = ['first_since', 'proposed', 'expected', 'possible', 'effective'].includes(c.temporalContext.status);
    return {
      ...c,
      importance,
      mustPreserve: c.mustPreserve || (isUsableClaim(c) && (importance >= 9 || (criticalTemporal && importance >= 7))),
    };
  });

  return {
    essence,
    rankedClaims,
    thingsNotToSay: response.thingsNotToSay,
    uncertaintyNotes: response.uncertaintyNotes,
    temporalNotes: response.temporalNotes,
  };
}

// When the significance call fails, fall back to an essence built purely from the
// ledger (top-ranked usable claim) — low confidence, clearly marked, no new prose.
export function fallbackEssence(claims: readonly Claim[]): StoryEssence | null {
  const usable = [...claims].filter(isUsableClaim).sort((a, b) => b.importance - a.importance);
  const top = usable[0];
  if (!top) return null;
  return StoryEssenceSchema.parse({
    event: top.text,
    whatChanged: top.text,
    novelty: usable.find((c) => c.temporalContext.status === 'first_since')?.text ?? null,
    significance: top.text,
    mostImportantFactClaimId: top.id,
    mostInterestingFactClaimId: top.id,
    affectedAudience: [],
    immediateConsequence: null,
    longerTermImplication: null,
    readerImpact: null,
    businessImpact: null,
    economicImpact: null,
    hiddenMechanism: null,
    surpriseElement: null,
    tension: null,
    whyItMatters: top.text,
    rankedFacts: usable.map((c) => ({ claimId: c.id, importance: c.importance, reason: 'ledger order (significance analysis unavailable)' })),
    editorialAngles: [],
    recommendedAngleId: null,
    confidence: 0.3,
  });
}
