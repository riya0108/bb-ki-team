import type { LlmClient } from '@bb/core';
import { BRAND_BRAIN } from '@bb/core';
import type { Claim, ContentDnaRecord, EditorialAngle, HookCandidate, StoryEssence } from '@bb/shared-types';
import { HookPatternSchema, isUsableClaim } from '@bb/shared-types';
import { z } from 'zod';

// Spec 17/52/61: "What is the strongest TRUE sentence I can say about this story?" —
// not "what is the most viral sentence I can invent?". Generated once per story and
// shared by every platform writer, so no writer invents its own story hook.

const GeneratedHooksSchema = z.object({
  hooks: z
    .array(z.object({ text: z.string().min(1), pattern: HookPatternSchema, supportingClaimIds: z.array(z.string()).min(1) }))
    .min(1)
    .max(10),
});

function describeClaim(c: Claim): string {
  const qualifier = c.temporalContext.qualifier ? ` | exact qualifier: "${c.temporalContext.qualifier}"` : '';
  return `- ${c.id} [${c.verificationStatus}${c.mustPreserve ? ', MUST PRESERVE' : ''}${qualifier}${c.attributedTo ? ` | attribute to ${c.attributedTo}` : ''}] ${c.text}`;
}

function buildSystemPrompt(dna: ContentDnaRecord): string {
  return `ROLE: editorial-hook-writer
You write opening lines (hooks) for a Bull or Bear story. Your question is: what is the strongest TRUE
sentence that makes this reader care? Not the loudest one.

Brand voice: ${BRAND_BRAIN.voice.descriptors.join(', ')}.
${BRAND_BRAIN.voice.principles.slice(0, 4).map((p) => `- ${p}`).join('\n')}
Creator hook patterns: ${dna.storytelling.hookPatterns.join(', ') || 'none noted'}
Never use: ${[...BRAND_BRAIN.forbiddenPhrases, ...dna.voice.forbiddenPhrases].join(', ')}. No em dashes.

Rules:
- Write 6-8 hooks using different patterns (surprisingFact, personalConsequence, unexpectedContrast,
  firstOrLast, scale, tension, whatThisMeansForYou, curiosityGap, counterintuitive, consequenceFirst).
- Every hook rests only on the usable claim IDs you list in supportingClaimIds.
- Keep protected facts' meaning exactly: a "first since X" stays a first (never "again", "another",
  "once more", "resumes", "continues"); "expected/proposed/could" stays uncertain; numbers keep
  their units; attributed claims keep their attribution.
- Serve the selected angle: open on the facts it rests on, not on a side detail.
- No sequence or causal framing ("before", "already", "after", "helped spark", "because") unless a
  claim explicitly states that order or cause.
- Lead with the strongest verified element. A good hook usually combines two of: novelty,
  consequence, scale, affected audience, contrast, unexpected implication.
- No fake curiosity (hiding the subject), no clickbait the facts don't support, no invented numbers,
  no "Here's why this matters", "In a recent development", "You might be wondering".
- User-suggested hooks are suggestions: adapt them only if every part is supported by the claims.`;
}

export interface GenerateHooksInput {
  essence: StoryEssence;
  angle: EditorialAngle | null;
  claims: readonly Claim[];
  hookSuggestions: readonly string[];
  contentDna: ContentDnaRecord;
  llm: LlmClient;
  runId: string;
  // Reasons earlier candidates were rejected, for the single regeneration attempt.
  rejectionFeedback?: readonly string[];
}

export async function generateHooks(input: GenerateHooksInput): Promise<HookCandidate[]> {
  const usable = input.claims.filter(isUsableClaim);
  const feedback =
    input.rejectionFeedback && input.rejectionFeedback.length > 0
      ? `\n\nYour previous hooks were ALL rejected:\n${input.rejectionFeedback.map((f) => `- ${f}`).join('\n')}\nWrite new ones that fix these problems.`
      : '';
  const content = `Story: ${input.essence.event}
What changed: ${input.essence.whatChanged}
Novelty: ${input.essence.novelty ?? 'none'}
Why it matters: ${input.essence.whyItMatters}
Reader impact: ${input.essence.readerImpact ?? 'not established'}
Selected angle: ${input.angle ? `${input.angle.angle} (${input.angle.emotionalMode}) — ${input.angle.rationale} [rests on ${input.angle.supportingClaimIds.join(', ')}]` : 'none selected'}

Usable claims:
${usable.map(describeClaim).join('\n')}

User-suggested hooks: ${input.hookSuggestions.length > 0 ? input.hookSuggestions.map((h) => `"${h}"`).join('; ') : 'none'}${feedback}`;

  const response = await input.llm.completeStructured(
    {
      system: buildSystemPrompt(input.contentDna),
      messages: [{ role: 'user', content }],
      runId: input.runId,
      stepId: input.rejectionFeedback ? 'editorial-hooks-regenerate' : 'editorial-hooks',
      temperature: 0.8,
    },
    GeneratedHooksSchema,
  );

  const known = new Set(input.claims.map((c) => c.id));
  const offset = input.rejectionFeedback ? 100 : 0;
  return response.hooks
    .map((h, i) => ({
      id: `hook_${offset + i + 1}`,
      text: h.text.trim(),
      pattern: h.pattern,
      supportingClaimIds: h.supportingClaimIds.filter((id) => known.has(id)),
    }))
    .filter((h) => h.supportingClaimIds.length > 0);
}
