import type { LlmClient } from '@bb/core';
import { loadCurrentDna } from '@bb/content-dna';
import { attachContentIds, createInterviewSession, getInterviewSession, recordAnswerAndNextQuestion } from '@bb/db';
import type { InterviewSession, Pool } from '@bb/db';
import { runQaGate } from '@bb/qa-gate';
import type { ContentDnaRecord, LinkedinPackage } from '@bb/shared-types';
import { createContentItem, recordQaResult, submitForReview } from '@bb/workflows';
import { z } from 'zod';

import { draftLinkedinPost } from './draftPost.js';
import { InterviewAlreadyCompletedError, InterviewNotCompletedError, InterviewNotFoundError } from './errors.js';
import { buildLinkedinPackage } from './packaging.js';

const CREATED_BY_AGENT = 'agent-01-linkedin';
const MIN_IDEAS = 3;
const MAX_IDEAS = 5;

// Spec 5.3 doesn't cap turn count explicitly ("stop once enough material exists, not by
// timer") but an adaptive loop still needs a hard backstop against a model that keeps
// deciding to continue — this is an engineering safety cap, not a spec target to hit.
const MAX_INTERVIEW_TURNS = 8;

export function buildTranscript(session: InterviewSession): string {
  return session.turns
    .filter((turn) => turn.answer !== null)
    .map((turn) => `Q: ${turn.question}\nA: ${turn.answer ?? ''}`)
    .join('\n\n');
}

function buildOpeningSystemPrompt(dna: ContentDnaRecord): string {
  return `You are opening an adaptive PostCast interview for LinkedIn content (spec 5.3). This is a
conversation, not a questionnaire. Ask one high-value opening question that will surface a specific
event, decision, lesson, disagreement, observation or example — never a generic "tell me about X".

Creator's Content DNA:
- Role: ${dna.identity.role}
- Expertise: ${dna.identity.expertise.join(', ') || 'unspecified'}
- Strongly held opinions: ${dna.opinions.stronglyHeld.join(', ') || 'none noted'}`;
}

async function buildOpeningQuestion(
  topic: string | null,
  dna: ContentDnaRecord,
  llm: LlmClient,
  runId: string,
): Promise<string> {
  const response = await llm.completeStructured(
    {
      system: buildOpeningSystemPrompt(dna),
      messages: [
        {
          role: 'user',
          content: topic
            ? `Chosen topic: ${topic}`
            : "No topic chosen yet — pick a high-value opening question from the creator's expertise/opinions.",
        },
      ],
      runId,
      stepId: 'postcast-opening-question',
    },
    z.object({ question: z.string() }),
  );
  return response.question;
}

export interface StartPostcastInterviewInput {
  pool: Pool;
  llm: LlmClient;
  topic: string | null;
  runId: string;
}

export async function startPostcastInterview(input: StartPostcastInterviewInput): Promise<InterviewSession> {
  const dna = await loadCurrentDna(input.pool);
  const firstQuestion = await buildOpeningQuestion(input.topic, dna, input.llm, input.runId);
  return createInterviewSession(input.pool, input.topic, firstQuestion);
}

const InterviewDecisionSchema = z.object({
  action: z.enum(['ask_followup', 'stop']),
  nextQuestion: z.string().nullable(),
});

// Spec 5.3's probing rules, verbatim as instructions rather than paraphrased, so the
// model applies the exact behaviors the spec calls out per answer type.
function buildDecisionSystemPrompt(): string {
  return `You are conducting an adaptive PostCast interview for LinkedIn content (spec 5.3). Ask one
strong question at a time, listening to the answer just given and choosing the next question based
on what was actually said. Apply these rules:
- When the answer is generic, probe for a concrete example.
- When the answer is a strong opinion, ask why and what changed their mind.
- When the answer is a story, ask for the moment that matters.
- When the answer mentions a measurable result, ask how they know and whether it can be verified.
- When the answer mentions another person or company, ask whether that is public information or private.

Stop once enough original, concrete material exists for several genuinely different posts. Do not
extend the interview merely to reach a target number of turns.

Respond with JSON: { "action": "ask_followup" | "stop", "nextQuestion": string | null }. If action is
"stop", nextQuestion must be null. If action is "ask_followup", nextQuestion must be exactly one
question, chosen per the rules above for the most recent answer.`;
}

async function decideNextQuestion(
  session: InterviewSession,
  latestAnswer: string,
  llm: LlmClient,
  runId: string,
): Promise<string | null> {
  const priorTranscript = buildTranscript(session);
  const lastQuestion = session.turns[session.turns.length - 1]?.question ?? '';
  const transcript = `${priorTranscript}${priorTranscript ? '\n\n' : ''}Q: ${lastQuestion}\nA: ${latestAnswer}`;

  const response = await llm.completeStructured(
    {
      system: buildDecisionSystemPrompt(),
      messages: [{ role: 'user', content: `Interview transcript so far:\n${transcript}` }],
      runId,
      stepId: 'postcast-decide-next',
    },
    InterviewDecisionSchema,
  );

  return response.action === 'stop' ? null : response.nextQuestion;
}

export interface AnswerPostcastInterviewTurnInput {
  pool: Pool;
  llm: LlmClient;
  sessionId: string;
  answer: string;
  runId: string;
}

export async function answerPostcastInterviewTurn(input: AnswerPostcastInterviewTurnInput): Promise<InterviewSession> {
  const session = await getInterviewSession(input.pool, input.sessionId);
  if (!session) throw new InterviewNotFoundError(input.sessionId);
  if (session.status === 'completed') throw new InterviewAlreadyCompletedError(input.sessionId);

  const forceStop = session.turns.length >= MAX_INTERVIEW_TURNS;
  const nextQuestion = forceStop ? null : await decideNextQuestion(session, input.answer, input.llm, input.runId);

  return recordAnswerAndNextQuestion(input.pool, input.sessionId, { answer: input.answer, nextQuestion });
}

const PostIdeaSchema = z.object({ topic: z.string(), angle: z.string(), coreClaim: z.string().nullable() });
export type PostcastPostIdea = z.infer<typeof PostIdeaSchema>;

const PostIdeasResponseSchema = z.object({ ideas: z.array(PostIdeaSchema).min(MIN_IDEAS).max(MAX_IDEAS) });

function buildIdeaExtractionSystemPrompt(dna: ContentDnaRecord): string {
  return `You are extracting post ideas from a completed PostCast interview transcript (spec 5.3).
Identify 3-5 genuinely different post ideas — never produce paraphrases of one idea (spec 5.8). Each
idea must be grounded in something the creator actually said in the transcript; never invent detail
beyond it.

Creator's Content DNA:
- Role: ${dna.identity.role}
- Primary topics: ${dna.topics.primary.join(', ') || 'none noted'}
- Topics to avoid: ${dna.topics.avoid.join(', ') || 'none noted'}`;
}

export interface GeneratePostcastPostIdeasInput {
  pool: Pool;
  llm: LlmClient;
  sessionId: string;
  runId: string;
}

export async function generatePostcastPostIdeas(input: GeneratePostcastPostIdeasInput): Promise<PostcastPostIdea[]> {
  const session = await getInterviewSession(input.pool, input.sessionId);
  if (!session) throw new InterviewNotFoundError(input.sessionId);
  if (session.status !== 'completed') throw new InterviewNotCompletedError(input.sessionId);

  const dna = await loadCurrentDna(input.pool);
  const transcript = buildTranscript(session);

  const response = await input.llm.completeStructured(
    {
      system: buildIdeaExtractionSystemPrompt(dna),
      messages: [{ role: 'user', content: `Interview transcript:\n${transcript}` }],
      runId: input.runId,
      stepId: 'postcast-extract-ideas',
    },
    PostIdeasResponseSchema,
  );

  return response.ideas;
}

export interface DraftPostcastIdeaInput {
  pool: Pool;
  llm: LlmClient;
  sessionId: string;
  topic: string;
  angle: string;
  coreClaim?: string | null;
  runId: string;
}

// Drafts, persists, QA-gates and submits for review one already-chosen idea from a
// completed interview (spec 5.3's "identify 3-5 ideas" is generatePostcastPostIdeas
// above; idea selection is the human's job, this covers turning the chosen one into a
// full post). The transcript is passed as source text so the draft can use the
// creator's own concrete example/story rather than inventing one.
export async function draftPostcastIdea(input: DraftPostcastIdeaInput): Promise<LinkedinPackage> {
  const session = await getInterviewSession(input.pool, input.sessionId);
  if (!session) throw new InterviewNotFoundError(input.sessionId);

  const dna = await loadCurrentDna(input.pool);
  const transcript = buildTranscript(session);
  const sourceTexts = transcript ? [transcript] : [];
  const coreClaim = input.coreClaim ?? null;

  const draft = await draftLinkedinPost({
    topic: input.topic,
    angle: input.angle,
    coreClaim,
    sourceTexts,
    contentDna: dna,
    llm: input.llm,
    runId: input.runId,
    stepId: `draft-postcast-${input.sessionId}`,
  });

  const item = await createContentItem(input.pool, {
    platform: 'linkedin',
    createdByAgent: CREATED_BY_AGENT,
    mode: 'postcast_interview',
    topic: input.topic,
    angle: input.angle,
    coreClaim,
    contentDnaVersion: dna.version,
    text: draft.finalPost,
    riskLevel: 'low',
  });

  const qa = await runQaGate({
    finalPost: draft.finalPost,
    sourceReferences: [],
    sourceTexts,
    contentDna: dna,
    status: item.status,
    llm: input.llm,
    runId: input.runId,
    stepId: `qa-${item.id}`,
    platform: 'LinkedIn',
  });
  await recordQaResult(input.pool, item.id, item.currentVersion, qa);

  const reviewedItem = await submitForReview(input.pool, item.id);
  await attachContentIds(input.pool, input.sessionId, [reviewedItem.id]);

  return buildLinkedinPackage(reviewedItem, draft, qa);
}
