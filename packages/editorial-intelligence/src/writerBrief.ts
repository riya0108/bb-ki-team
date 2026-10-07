import type { Claim, EditorialBrief, EditorialSummary } from '@bb/shared-types';
import { EditorialBriefSchema, EditorialSummarySchema, isUsableClaim } from '@bb/shared-types';

// The one rendering of an EditorialBrief that every platform writer receives, so X,
// LinkedIn and Blog share a single verified factual core (spec 25) and none of them
// re-interprets raw research (spec 18/62). Platform prompts add only presentation rules.

// Spec 51 — the writing principles every platform writer prompt carries.
export const STORY_FIRST_WRITING_RULES: readonly string[] = [
  'Understand the story before writing. The editorial brief below IS the story: do not reinterpret it.',
  'Lead with the most important verified information.',
  'Do not summarize research chronologically ("source 1 says... source 2 says..."). Order: most important fact, why it is surprising, evidence, mechanism, consequence, what happens next.',
  'The first sentence must earn the next sentence.',
  'Prefer specificity over generic commentary.',
  'Use surprise only when the facts support it. Use personal consequences only when genuinely relevant. Use contrast only when it exists in the evidence.',
  'Never manufacture curiosity by hiding or distorting facts. Never create a stronger claim than the evidence supports.',
  'Preserve numbers (with their units), dates, attribution, uncertainty, temporal meaning and causality exactly as the claims state them.',
  'Never use "again", "first", "only", "largest", "record", "never" or similar casually: each must be backed by a claim.',
  'Every strong factual statement, and especially the opening line, must map to a verified claim.',
  'The best hook is not the loudest one. It is the strongest TRUE statement that makes the reader care.',
];

function claimLine(c: Claim): string {
  const qualifier = c.temporalContext.qualifier ? ` | keep exactly: "${c.temporalContext.qualifier}"` : '';
  const attribution = c.attributedTo ? ` | attribute to ${c.attributedTo}` : '';
  return `- ${c.id} [${c.type}, ${c.verificationStatus}${qualifier}${attribution}] ${c.text}`;
}

export function renderBriefForWriter(brief: EditorialBrief): string {
  if (brief.kind === 'opinion') {
    return `EDITORIAL BRIEF (opinion / analysis piece — no external research was needed)
Topic: ${brief.topic}
${brief.userRequest.editorialIntent.length > 0 ? `User's editorial intent: ${brief.userRequest.editorialIntent.join('; ')}\n` : ''}${brief.userRequest.styleRequests.length > 0 ? `Style requests: ${brief.userRequest.styleRequests.join('; ')}\n` : ''}Write from the brand's and creator's perspective. Do not state specific facts, numbers, dates,
quotes or events as if verified: there is no verified research behind this piece. Frame views as views.`;
  }

  const byId = new Map(brief.claims.map((c) => [c.id, c]));
  const usable = brief.claims.filter(isUsableClaim).sort((a, b) => b.importance - a.importance);
  const notUsable = brief.claims.filter((c) => !isUsableClaim(c));
  const protectedClaims = brief.protectedClaimIds.map((id) => byId.get(id)).filter((c): c is Claim => c !== undefined);
  const essence = brief.storyEssence;

  const sections: string[] = [];
  sections.push('EDITORIAL BRIEF — the verified core of this story. Platform writers optimise presentation only.');
  sections.push(`Topic: ${brief.topic}\nRisk level: ${brief.riskLevel}`);

  if (brief.kind === 'insufficient_evidence') {
    sections.push(`WARNING: research could not verify this story (no usable evidence was found).
- Do NOT state any specific fact, number, date, quote or event as verified.
- You may frame the topic as a question, an explainer of how such things work, or explicitly as
  unconfirmed ("reports say", "if confirmed"). Say plainly in factCheckStatus that the facts are unverified.`);
  }

  if (essence) {
    sections.push(`STORY ESSENCE
- Event: ${essence.event}
- What changed: ${essence.whatChanged}
- Novelty: ${essence.novelty ?? 'none established'}
- Why it matters: ${essence.whyItMatters}
- Reader impact: ${essence.readerImpact ?? 'not established'}
- Affected audience: ${essence.affectedAudience.join(', ') || 'not established'}
- Hidden mechanism: ${essence.hiddenMechanism ?? 'not established'}
- Tension: ${essence.tension ?? 'none established'}
- Most important fact: ${byId.get(essence.mostImportantFactClaimId)?.text ?? essence.mostImportantFactClaimId}`);
  }

  if (brief.selectedAngle) {
    sections.push(`SELECTED ANGLE: ${brief.selectedAngle.angle}
Why: ${brief.selectedAngle.rationale}
Audience: ${brief.selectedAngle.audience} | Emotional mode: ${brief.selectedAngle.emotionalMode} (must come from the facts, never manufactured)`);
  }

  if (brief.selectedHooks.length > 0) {
    sections.push(`APPROVED HOOKS (fact-checked; open with one of these or a tightening of one that keeps every fact and qualifier):
${brief.selectedHooks.map((h) => `- [${h.supportingClaimIds.join(', ')}] ${h.text}`).join('\n')}`);
  }

  sections.push(`VERIFIED CLAIMS you may state as fact (most important first):
${usable.map(claimLine).join('\n') || '(none)'}`);

  if (protectedClaims.length > 0) {
    sections.push(`PROTECTED FACTS — if you use one, its meaning must stay exactly the same (temporal status,
certainty, numbers and units, attribution):
${protectedClaims.map(claimLine).join('\n')}`);
  }

  if (notUsable.length > 0) {
    sections.push(`NOT VERIFIED — never state these as fact. Leave them out, or present them explicitly as unconfirmed:
${notUsable.map(claimLine).join('\n')}`);
  }

  if (brief.thingsNotToSay.length > 0) {
    sections.push(`THINGS NOT TO SAY:\n${brief.thingsNotToSay.map((t) => `- ${t}`).join('\n')}`);
  }
  if (brief.temporalNotes.length > 0) sections.push(`TEMPORAL NOTES:\n${brief.temporalNotes.map((t) => `- ${t}`).join('\n')}`);
  if (brief.uncertaintyNotes.length > 0) sections.push(`UNCERTAINTY:\n${brief.uncertaintyNotes.map((t) => `- ${t}`).join('\n')}`);
  if (brief.userRequest.styleRequests.length > 0) sections.push(`STYLE REQUESTS: ${brief.userRequest.styleRequests.join('; ')}`);

  const publishers = brief.sources
    .filter((s) => s.tier !== 'discovery')
    .map((s) => `${s.publisher ?? 'source'}${s.title ? `: ${s.title}` : ''}${s.url ? ` (${s.url})` : ''}`);
  if (publishers.length > 0) sections.push(`SOURCES (for attribution/citation where the platform uses them):\n${[...new Set(publishers)].map((p) => `- ${p}`).join('\n')}`);

  sections.push('Do not add any fact, number, date, name, cause or quote that is not in the verified claims above.');
  return sections.join('\n\n');
}

// For the existing QA checks (unsupported numbers, originality) that compare a draft
// to "source text": the verified claims and their evidence are that text now.
export function briefSourceTexts(brief: EditorialBrief): string[] {
  return brief.claims
    .filter(isUsableClaim)
    .map((c) => [c.text, ...c.numbers, ...c.dates, ...c.evidence.filter((e) => e.quoteFound).map((e) => e.quote)].join('\n'));
}

export function briefSourceReferences(brief: EditorialBrief): string[] {
  const usedIds = new Set(brief.claims.filter(isUsableClaim).flatMap((c) => c.sourceIds));
  return [
    ...new Set(
      brief.sources
        .filter((s) => usedIds.has(s.id) && s.url !== null && s.tier !== 'discovery')
        .map((s) => s.url)
        .filter((u): u is string => u !== null),
    ),
  ];
}

export function buildEditorialSummary(brief: EditorialBrief): EditorialSummary {
  const byId = new Map(brief.claims.map((c) => [c.id, c]));
  const keyFacts = brief.keyFactClaimIds
    .map((id) => byId.get(id))
    .filter((c): c is Claim => c !== undefined)
    .map((c) => ({ claimId: c.id, text: c.text, status: c.verificationStatus }));
  const uncertain = brief.claims
    .filter((c) => !isUsableClaim(c))
    .map((c) => ({ claimId: c.id, text: c.text, status: c.verificationStatus }));
  const notes = [
    ...(brief.kind === 'insufficient_evidence' ? ['Research could not verify this story — every factual statement needs manual checking.'] : []),
    ...(brief.kind === 'opinion' ? ['Opinion/analysis piece: no external research was run.'] : []),
    ...brief.uncertaintyNotes,
    ...brief.research.failures.slice(0, 5).map((f) => `Could not fetch ${f.url}: ${f.reason}`),
  ];
  return EditorialSummarySchema.parse({
    briefId: brief.id,
    kind: brief.kind,
    story: brief.storyEssence?.event ?? null,
    whyItMatters: brief.storyEssence?.whyItMatters ?? null,
    selectedAngle: brief.selectedAngle?.angle ?? null,
    angleRationale: brief.selectedAngle?.rationale ?? null,
    selectedHook: brief.selectedHooks[0]?.text ?? null,
    keyFacts,
    uncertainClaims: uncertain,
    sourceReferences: briefSourceReferences(brief),
    notes,
  });
}

// Reads a brief back out of a stored content_items.package (edit flows, sibling
// lookups). Anything that doesn't validate is treated as "no brief", never trusted.
export function editorialBriefFromPackage(pkg: Record<string, unknown> | null): EditorialBrief | null {
  if (!pkg || !('editorialBrief' in pkg)) return null;
  const parsed = EditorialBriefSchema.safeParse(pkg.editorialBrief);
  return parsed.success ? parsed.data : null;
}

// Compact guidance for edit/revise prompts: an edit may change wording, never the
// verified meaning. Empty for opinion briefs (no claims to protect).
export function renderProtectedFactsForEditor(brief: EditorialBrief | null): string {
  if (!brief || brief.kind === 'opinion') return '';
  const byId = new Map(brief.claims.map((c) => [c.id, c]));
  const protectedClaims = brief.protectedClaimIds.map((id) => byId.get(id)).filter((c): c is Claim => c !== undefined);
  const unusable = brief.claims.filter((c) => !isUsableClaim(c));
  return `

This post was written from a verified editorial brief. Whatever the instruction says, keep these
facts' meaning exactly (temporal status, certainty, numbers and units, attribution):
${protectedClaims.map(claimLine).join('\n') || '(none)'}
${unusable.length > 0 ? `Never state these as fact:\n${unusable.map(claimLine).join('\n')}\n` : ''}${brief.thingsNotToSay.length > 0 ? `Never say:\n${brief.thingsNotToSay.map((t) => `- ${t}`).join('\n')}\n` : ''}If the instruction asks for something that would break one of these, keep the fact and say so in
factCheckStatus.`;
}

// Drops style/script blocks and tags so CSS values and markup attributes in a Blog
// item's HTML are never read as claims by QA or cross-platform comparison.
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
