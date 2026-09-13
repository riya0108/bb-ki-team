import type { InterviewSession } from '@bb/db';
import { describe, expect, it } from 'vitest';

import { buildTranscript } from './postcastInterview.js';

function session(turns: InterviewSession['turns']): InterviewSession {
  return {
    id: 'session-1',
    topic: 'test topic',
    status: 'active',
    turns,
    contentIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('buildTranscript', () => {
  it('joins answered turns as Q/A pairs and drops the trailing unanswered question', () => {
    const transcript = buildTranscript(
      session([
        { question: 'What happened?', answer: 'We cut prices.', askedAt: new Date().toISOString() },
        { question: 'Why?', answer: 'Churn data.', askedAt: new Date().toISOString() },
        { question: 'And then?', answer: null, askedAt: new Date().toISOString() },
      ]),
    );

    expect(transcript).toBe('Q: What happened?\nA: We cut prices.\n\nQ: Why?\nA: Churn data.');
  });

  it('returns an empty string for a session with no answered turns', () => {
    expect(buildTranscript(session([{ question: 'Opening?', answer: null, askedAt: new Date().toISOString() }]))).toBe(
      '',
    );
  });
});
