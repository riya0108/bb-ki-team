import type { Queryable } from '../pool.js';

export interface InterviewTurn {
  question: string;
  answer: string | null;
  askedAt: string;
}

export interface InterviewSession {
  id: string;
  topic: string | null;
  status: 'active' | 'completed';
  turns: InterviewTurn[];
  contentIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface InterviewSessionRow {
  id: string;
  topic: string | null;
  status: string;
  turns: InterviewTurn[];
  content_ids: string[];
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: InterviewSessionRow): InterviewSession {
  return {
    id: row.id,
    topic: row.topic,
    status: row.status === 'completed' ? 'completed' : 'active',
    turns: row.turns,
    contentIds: row.content_ids,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function createInterviewSession(
  db: Queryable,
  topic: string | null,
  firstQuestion: string,
): Promise<InterviewSession> {
  const firstTurn: InterviewTurn = { question: firstQuestion, answer: null, askedAt: new Date().toISOString() };
  const result = await db.query<InterviewSessionRow>(
    'INSERT INTO interview_sessions (topic, turns) VALUES ($1, $2) RETURNING *',
    [topic, JSON.stringify([firstTurn])],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createInterviewSession: insert returned no row');
  return mapRow(row);
}

export async function getInterviewSession(db: Queryable, id: string): Promise<InterviewSession | null> {
  const result = await db.query<InterviewSessionRow>('SELECT * FROM interview_sessions WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

// Fills in the answer to the current (last, unanswered) turn, and either appends the
// next question or marks the session completed if nextQuestion is null.
export async function recordAnswerAndNextQuestion(
  db: Queryable,
  id: string,
  input: { answer: string; nextQuestion: string | null },
): Promise<InterviewSession> {
  const session = await getInterviewSession(db, id);
  if (!session) throw new Error(`recordAnswerAndNextQuestion: no interview session with id ${id}`);

  const turns = [...session.turns];
  const lastIndex = turns.length - 1;
  const lastTurn = turns[lastIndex];
  if (!lastTurn) throw new Error(`recordAnswerAndNextQuestion: session ${id} has no turns`);
  turns[lastIndex] = { ...lastTurn, answer: input.answer };

  if (input.nextQuestion) {
    turns.push({ question: input.nextQuestion, answer: null, askedAt: new Date().toISOString() });
  }

  const status = input.nextQuestion ? 'active' : 'completed';
  const result = await db.query<InterviewSessionRow>(
    'UPDATE interview_sessions SET turns = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *',
    [id, JSON.stringify(turns), status],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`recordAnswerAndNextQuestion: no interview session with id ${id}`);
  return mapRow(row);
}

export async function attachContentIds(db: Queryable, id: string, contentIds: string[]): Promise<InterviewSession> {
  const result = await db.query<InterviewSessionRow>(
    `UPDATE interview_sessions
     SET content_ids = content_ids || $2::uuid[], status = 'completed', updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, contentIds],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`attachContentIds: no interview session with id ${id}`);
  return mapRow(row);
}
