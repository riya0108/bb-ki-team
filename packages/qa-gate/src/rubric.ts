import type { LlmClient } from '@bb/core';
import type { ContentDnaRecord, QaDimensionResult } from '@bb/shared-types';
import { QaDimensionResultSchema } from '@bb/shared-types';

export interface RubricCheckInput {
  finalPost: string;
  sourceTexts: string[];
  dna: ContentDnaRecord;
  llm: LlmClient;
  runId: string;
  stepId: string;
}

async function callRubric(
  llm: LlmClient,
  runId: string,
  stepId: string,
  system: string,
  finalPost: string,
): Promise<QaDimensionResult> {
  return llm.completeStructured(
    {
      system,
      messages: [{ role: 'user', content: finalPost }],
      runId,
      stepId,
    },
    QaDimensionResultSchema,
  );
}

export async function checkVoiceMatchRubric(input: RubricCheckInput): Promise<QaDimensionResult> {
  const system = `You are a strict editor checking whether a LinkedIn post matches a creator's established voice.
Voice profile: tone=${input.dna.voice.tone}, energy=${input.dna.voice.energy ?? 'unspecified'}, directness=${input.dna.voice.directness ?? 'unspecified'}.
Judge tone, rhythm, and word choice against this profile (beyond any forbidden-word list, which is checked separately).
Respond with status PASS/WARN/FAIL, a one-sentence "notes" explanation, and optional "evidence" quotes.`;
  return callRubric(input.llm, input.runId, input.stepId, system, input.finalPost);
}

function ngramOverlapRatio(a: string, b: string, n = 5): number {
  const words = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);
  const ngrams = (tokens: string[]): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i <= tokens.length - n; i += 1) set.add(tokens.slice(i, i + n).join(' '));
    return set;
  };
  const aGrams = ngrams(words(a));
  if (aGrams.size === 0) return 0;
  const bGrams = ngrams(words(b));
  let shared = 0;
  for (const gram of aGrams) if (bGrams.has(gram)) shared += 1;
  return shared / aGrams.size;
}

export async function checkOriginality(input: RubricCheckInput): Promise<QaDimensionResult> {
  const maxOverlap = Math.max(0, ...input.sourceTexts.map((text) => ngramOverlapRatio(input.finalPost, text)));
  if (maxOverlap > 0.3) {
    return {
      status: 'FAIL',
      notes: `Post shares ${Math.round(maxOverlap * 100)}% of its 5-word sequences with a source text — likely a disguised rewrite (spec 5.5).`,
      evidence: [`n-gram overlap ratio: ${maxOverlap.toFixed(2)}`],
    };
  }

  if (input.sourceTexts.length === 0) {
    return { status: 'PASS', notes: 'No source material to compare against; treated as original.' };
  }

  const system = `You are checking whether a LinkedIn post is an original expression of an idea from source material, or a disguised rewrite (spec 5.5: never copy a source's structure, distinctive phrasing, or conclusion line-for-line).
Judge whether the post adds the author's own angle, analysis, or interpretation rather than merely paraphrasing the source.
Respond with status PASS/WARN/FAIL, a one-sentence "notes" explanation, and optional "evidence" quotes.`;
  return callRubric(input.llm, input.runId, input.stepId, system, input.finalPost);
}

export async function checkPlatformFit(input: RubricCheckInput): Promise<QaDimensionResult> {
  const system = `You are checking whether a post is native to LinkedIn: professional-adjacent, uses line breaks for readability, appropriate length, no platform-mismatched formatting (e.g. no hashtag spam, no X-style thread numbering).
Respond with status PASS/WARN/FAIL, a one-sentence "notes" explanation, and optional "evidence" quotes.`;
  return callRubric(input.llm, input.runId, input.stepId, system, input.finalPost);
}

export async function checkClarity(input: RubricCheckInput): Promise<QaDimensionResult> {
  const system = `You are checking whether a smart non-expert reader could follow this post without prior context.
Respond with status PASS/WARN/FAIL, a one-sentence "notes" explanation, and optional "evidence" quotes.`;
  return callRubric(input.llm, input.runId, input.stepId, system, input.finalPost);
}

export async function checkHookHonesty(input: RubricCheckInput): Promise<QaDimensionResult> {
  const system = `You are checking whether the post's opening hook is strong without being misleading — it may create curiosity but must not imply something the body doesn't deliver (spec: "the hook can be strong, it cannot be false").
Respond with status PASS/WARN/FAIL, a one-sentence "notes" explanation, and optional "evidence" quotes.`;
  return callRubric(input.llm, input.runId, input.stepId, system, input.finalPost);
}
