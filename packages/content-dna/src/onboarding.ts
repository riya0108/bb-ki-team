import type { ContentDnaDraft } from '@bb/shared-types';
import { ContentDnaDraftSchema } from '@bb/shared-types';
import type { LlmClient } from '@bb/core';

const ONBOARDING_SYSTEM_PROMPT = `You are the Content DNA Analyst for a content team (spec section 5.2).
Given writing samples (and optionally explicit answers the creator already gave), extract a
structured voice profile: role/expertise/audience, preferred and avoided topics, strongly-held
and evolving opinions, vocabulary/tone/sentence rhythm, hook and storytelling patterns, and
platform preferences.

Rules:
- Only state something as identity/expertise/audience if the samples (or explicit answers)
  actually support it. Never invent a role, audience, or opinion the samples don't evidence.
- If the samples are too thin to confidently fill a field, leave it out rather than guessing,
  and instead add a specific, high-value question to "pendingQuestions" — ask only about
  information that materially changes the output, not generic filler questions.
- Do not ask more than 5 pendingQuestions.`;

function buildUserPrompt(samples: string[], explicitAnswers?: Record<string, string>): string {
  const sampleBlock = samples.length > 0
    ? samples.map((sample, index) => `--- Sample ${index + 1} ---\n${sample}`).join('\n\n')
    : '(no writing samples provided)';

  const answersBlock =
    explicitAnswers && Object.keys(explicitAnswers).length > 0
      ? `\n\nExplicit answers the creator already gave:\n${Object.entries(explicitAnswers)
          .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
          .join('\n\n')}`
      : '';

  return `${sampleBlock}${answersBlock}`;
}

export async function buildOnboardingDraft(
  llm: LlmClient,
  samples: string[],
  explicitAnswers?: Record<string, string>,
): Promise<ContentDnaDraft> {
  return llm.completeStructured(
    {
      system: ONBOARDING_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(samples, explicitAnswers) }],
      runId: 'content-dna-onboarding',
      stepId: 'build-draft',
    },
    ContentDnaDraftSchema,
  );
}
