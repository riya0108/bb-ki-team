try {
  process.loadEnvFile();
} catch {
  // no .env file present — tests below are skipped without TEST_DATABASE_URL.
}

import { createFakeLlmClient } from '@bb/core/testing';
import { createPool, insertContentDna } from '@bb/db';
import type { Pool } from '@bb/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  InterviewAlreadyCompletedError,
  InterviewNotCompletedError,
  answerPostcastInterviewTurn,
  draftPostcastIdea,
  generatePostcastPostIdeas,
  startPostcastInterview,
} from './index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const dnaBody = {
  identity: { role: 'Founder', expertise: ['fintech'], audiencePrimary: 'Indian professionals' },
  topics: { primary: [], secondary: [], avoid: [] },
  opinions: { stronglyHeld: ['Zero MDR cannot last'], nuanced: [], evolving: [], unknown: [] },
  voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
  storytelling: { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
  personalContext: { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
  platformPreferences: {},
  learning: { confirmedPreferences: [], inferredPreferences: [], pendingQuestions: [] },
};

function draftJson(): string {
  return JSON.stringify({
    hookOptions: ['A strong hook'],
    finalPost: 'HOOK\nCONTEXT\nINSIGHT\nMECHANISM\nEXAMPLE\nSO WHAT\nCLOSE',
    visualSuggestion: null,
    firstCommentOptional: null,
    factCheckStatus: 'Grounded in the interview transcript.',
    originalityStatus: 'Original to the creator.',
  });
}

// Scripts a short interview: opens, asks exactly one follow-up, then stops.
function buildLlmForShortInterview(): ReturnType<typeof createFakeLlmClient> {
  let decisionCalls = 0;
  return createFakeLlmClient((input) => {
    const system = input.system ?? '';
    if (system.includes('opening an adaptive PostCast interview')) {
      return JSON.stringify({ question: 'What is a decision you made recently that surprised people?' });
    }
    if (system.includes('conducting an adaptive PostCast interview')) {
      decisionCalls += 1;
      if (decisionCalls === 1) {
        return JSON.stringify({ action: 'ask_followup', nextQuestion: 'What made that the right call?' });
      }
      return JSON.stringify({ action: 'stop', nextQuestion: null });
    }
    if (system.includes('extracting post ideas from a completed PostCast interview')) {
      return JSON.stringify({
        ideas: [
          { topic: 'Zero MDR is unsustainable', angle: 'It shifts cost onto banks silently', coreClaim: null },
          { topic: 'Merchant onboarding speed', angle: 'Speed beat cost as the real UPI moat', coreClaim: null },
          { topic: 'Founder decision-making under pressure', angle: 'Why the obvious call was wrong', coreClaim: null },
        ],
      });
    }
    if (system.includes('Thought Leadership Head Agent')) {
      return draftJson();
    }
    return JSON.stringify({ status: 'PASS', notes: 'ok' });
  });
}

describeIfDb('packages/agents/linkedin PostCast interview (integration, real Postgres)', () => {
  let pool: Pool;
  let dnaVersion: number;
  let interviewIdsThisTest: string[] = [];
  let contentIdsThisTest: string[] = [];

  beforeAll(async () => {
    pool = createPool(databaseUrl ?? '');
    const dna = await insertContentDna(pool, { version: Date.now() % 1_000_000, status: 'active', body: dnaBody });
    dnaVersion = dna.version;
  });

  afterEach(async () => {
    if (contentIdsThisTest.length > 0) {
      await pool.query('DELETE FROM content_items WHERE id = ANY($1::uuid[])', [contentIdsThisTest]);
    }
    if (interviewIdsThisTest.length > 0) {
      await pool.query('DELETE FROM interview_sessions WHERE id = ANY($1::uuid[])', [interviewIdsThisTest]);
    }
    contentIdsThisTest = [];
    interviewIdsThisTest = [];
  });

  afterAll(async () => {
    await pool.query('DELETE FROM content_dna WHERE version = $1', [dnaVersion]);
    await pool.end();
  });

  it('runs a full interview: open, follow up, stop, extract ideas, draft the chosen one', async () => {
    const llm = buildLlmForShortInterview();

    const session = await startPostcastInterview({ pool, llm, topic: 'A recent hard decision', runId: 'test-run' });
    interviewIdsThisTest.push(session.id);
    expect(session.status).toBe('active');
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]?.answer).toBeNull();

    const afterFirstAnswer = await answerPostcastInterviewTurn({
      pool,
      llm,
      sessionId: session.id,
      answer: 'We cut prices when everyone said hold the line.',
      runId: 'test-run',
    });
    expect(afterFirstAnswer.status).toBe('active');
    expect(afterFirstAnswer.turns).toHaveLength(2);
    expect(afterFirstAnswer.turns[0]?.answer).toBe('We cut prices when everyone said hold the line.');

    const afterSecondAnswer = await answerPostcastInterviewTurn({
      pool,
      llm,
      sessionId: session.id,
      answer: 'Because our churn data showed price was the top objection.',
      runId: 'test-run',
    });
    expect(afterSecondAnswer.status).toBe('completed');
    expect(afterSecondAnswer.turns).toHaveLength(2);

    await expect(
      answerPostcastInterviewTurn({ pool, llm, sessionId: session.id, answer: 'anything', runId: 'test-run' }),
    ).rejects.toBeInstanceOf(InterviewAlreadyCompletedError);

    const ideas = await generatePostcastPostIdeas({ pool, llm, sessionId: session.id, runId: 'test-run' });
    expect(ideas.length).toBeGreaterThanOrEqual(3);

    const chosen = ideas[0];
    if (!chosen) throw new Error('expected at least one idea');

    const pkg = await draftPostcastIdea({
      pool,
      llm,
      sessionId: session.id,
      topic: chosen.topic,
      angle: chosen.angle,
      coreClaim: chosen.coreClaim,
      runId: 'test-run',
    });
    contentIdsThisTest.push(pkg.contentId);

    expect(pkg.mode).toBe('postcast_interview');
    expect(pkg.status).toBe('in_review');

    const updatedSession = await pool.query<{ content_ids: string[] }>(
      'SELECT content_ids FROM interview_sessions WHERE id = $1',
      [session.id],
    );
    expect(updatedSession.rows[0]?.content_ids).toContain(pkg.contentId);
  });

  it('forces a stop once the interview reaches the turn safety cap even if the model keeps asking', async () => {
    const alwaysContinueLlm = createFakeLlmClient((input) => {
      const system = input.system ?? '';
      if (system.includes('opening an adaptive PostCast interview')) {
        return JSON.stringify({ question: 'Opening question?' });
      }
      if (system.includes('conducting an adaptive PostCast interview')) {
        return JSON.stringify({ action: 'ask_followup', nextQuestion: 'Another question?' });
      }
      return JSON.stringify({ status: 'PASS', notes: 'ok' });
    });

    const session = await startPostcastInterview({ pool, llm: alwaysContinueLlm, topic: 'x', runId: 'test-run' });
    interviewIdsThisTest.push(session.id);

    let current = session;
    for (let i = 0; i < 10; i += 1) {
      if (current.status === 'completed') break;
      current = await answerPostcastInterviewTurn({
        pool,
        llm: alwaysContinueLlm,
        sessionId: session.id,
        answer: `answer ${i}`,
        runId: 'test-run',
      });
    }

    expect(current.status).toBe('completed');
    expect(current.turns.length).toBeLessThanOrEqual(8);
  });

  it('refuses to extract post ideas from an interview that has not finished', async () => {
    const llm = buildLlmForShortInterview();
    const session = await startPostcastInterview({ pool, llm, topic: 'still going', runId: 'test-run' });
    interviewIdsThisTest.push(session.id);

    await expect(generatePostcastPostIdeas({ pool, llm, sessionId: session.id, runId: 'test-run' })).rejects.toBeInstanceOf(
      InterviewNotCompletedError,
    );
  });
});
