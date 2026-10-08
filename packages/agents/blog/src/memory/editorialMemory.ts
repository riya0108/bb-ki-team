import type { Queryable } from '@bb/db';
import {
  findLiveEditorialMemories,
  getEditorialMemory,
  insertEditorialMemory,
  listLiveEditorialMemories,
  markEditorialMemoriesUsed,
  updateEditorialMemory,
} from '@bb/db';
import type { EditorialMemory, MemoryCategory, MemorySource } from '@bb/shared-types';

import { categoryFor, statementFor } from './subjects.js';

// Blog Editorial Memory (spec 8/9). Rules that keep it from becoming a junk drawer:
// - one live memory per subject+polarity: a repeated signal reinforces it;
// - explicit feedback is CONFIRMED at once; observed signals (edit diffs, approvals)
//   start INFERRED and only become CONFIRMED after repeated confirmation — the same
//   "deliberate or repeated, never one-off" rule Content DNA follows;
// - an explicit opposite signal supersedes the old memory (kept for audit, never
//   deleted); an observed one only weakens a confirmed memory;
// - REJECTED memories stay live so the writer is told never to reintroduce them;
// - TEMPORARY memories expire; unconfirmed INFERRED memories decay out of use.

export const MEMORY_SCOPE = 'blog';
const CONFIRM_AFTER_OBSERVATIONS = 3;
const INFERRED_DECAY_DAYS = 120;
const MAX_EVIDENCE = 20;

export type SignalStrength = 'explicit' | 'observed';

export interface EditorialSignal {
  subject: string;
  polarity: 'prefer' | 'avoid';
  // Optional override; defaults to the subject vocabulary's statement.
  statement?: string;
  category?: MemoryCategory;
  source: MemorySource;
  strength: SignalStrength;
  contentId?: string | null;
  // Makes the memory TEMPORARY until this time.
  validUntil?: string | null;
  // Store as EXPERIMENTAL (an idea to try, not a preference).
  experimental?: boolean;
}

export interface SignalOutcome {
  memory: EditorialMemory;
  action: 'created' | 'reinforced' | 'superseded' | 'weakened_opposite' | 'kept_rejected';
}

function evidenceWith(memory: EditorialMemory | null, signal: EditorialSignal): EditorialMemory['evidence'] {
  const entry = { contentId: signal.contentId ?? null, signal: `${signal.source}:${signal.strength}`, at: new Date().toISOString() };
  return [...(memory?.evidence ?? []), entry].slice(-MAX_EVIDENCE);
}

export async function recordEditorialSignal(db: Queryable, signal: EditorialSignal): Promise<SignalOutcome> {
  const statement = signal.statement ?? statementFor(signal.subject, signal.polarity) ?? signal.subject;
  const live = await findLiveEditorialMemories(db, MEMORY_SCOPE, signal.subject);
  const same = live.find((m) => m.polarity === signal.polarity) ?? null;
  const opposite = live.find((m) => m.polarity !== signal.polarity) ?? null;
  const explicit = signal.strength === 'explicit';

  if (same) {
    if (same.status === 'REJECTED' && !explicit) {
      // An observed pattern never resurrects something the human rejected.
      const memory = await updateEditorialMemory(db, same.memoryId, { evidence: evidenceWith(same, signal) });
      return { memory, action: 'kept_rejected' };
    }
    const timesConfirmed = same.timesConfirmed + 1;
    // (A REJECTED memory only reaches here on explicit feedback: the human re-asserted it.)
    const confirmed = explicit || same.status === 'CONFIRMED' || timesConfirmed >= CONFIRM_AFTER_OBSERVATIONS;
    const status = confirmed ? 'CONFIRMED' : same.status;
    const memory = await updateEditorialMemory(db, same.memoryId, {
      timesConfirmed,
      status: signal.validUntil ? 'TEMPORARY' : status,
      confidence: Math.min(0.95, same.confidence + (explicit ? 0.3 : 0.15)),
      validUntil: signal.validUntil ?? null,
      evidence: evidenceWith(same, signal),
      ...(explicit && signal.statement ? { statement } : {}),
    });
    return { memory, action: 'reinforced' };
  }

  if (opposite && !explicit && opposite.status === 'CONFIRMED') {
    // A one-off observation doesn't overturn a confirmed preference — it only weakens it.
    const memory = await updateEditorialMemory(db, opposite.memoryId, {
      timesRejected: opposite.timesRejected + 1,
      confidence: Math.max(0.3, opposite.confidence - 0.1),
      evidence: evidenceWith(opposite, signal),
    });
    return { memory, action: 'weakened_opposite' };
  }

  const status = signal.validUntil ? 'TEMPORARY' : signal.experimental ? 'EXPERIMENTAL' : explicit ? 'CONFIRMED' : 'INFERRED';
  const memory = await insertEditorialMemory(db, {
    scope: MEMORY_SCOPE,
    category: signal.category ?? categoryFor(signal.subject),
    subject: signal.subject,
    polarity: signal.polarity,
    statement,
    confidence: explicit ? 0.85 : 0.4,
    source: signal.source,
    status,
    timesConfirmed: 1,
    validUntil: signal.validUntil ?? null,
    evidence: evidenceWith(null, signal),
  });
  if (opposite) {
    await updateEditorialMemory(db, opposite.memoryId, { supersededById: memory.memoryId });
    return { memory, action: 'superseded' };
  }
  return { memory, action: 'created' };
}

// Human review of a memory in the dashboard.
export async function setEditorialMemoryStatus(db: Queryable, memoryId: string, decision: 'confirm' | 'reject'): Promise<EditorialMemory> {
  const current = await getEditorialMemory(db, memoryId);
  if (!current) throw new EditorialMemoryNotFoundError(memoryId);
  return decision === 'confirm'
    ? updateEditorialMemory(db, memoryId, { status: 'CONFIRMED', confidence: Math.max(current.confidence, 0.85), timesConfirmed: current.timesConfirmed + 1 })
    : updateEditorialMemory(db, memoryId, { status: 'REJECTED', timesRejected: current.timesRejected + 1 });
}

export class EditorialMemoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Editorial memory not found: ${id}`);
    this.name = 'EditorialMemoryNotFoundError';
  }
}

// Which memories may influence a draft right now, and how strongly.
export function activeMemories(memories: readonly EditorialMemory[], now: Date = new Date()): EditorialMemory[] {
  return memories.filter((m) => {
    if (m.supersededById !== null) return false;
    if (m.status === 'TEMPORARY') return m.validUntil !== null && new Date(m.validUntil) > now;
    if (m.status === 'INFERRED') {
      const ageDays = (now.getTime() - new Date(m.updatedAt).getTime()) / 86_400_000;
      return !(ageDays > INFERRED_DECAY_DAYS && m.timesConfirmed < 2) && m.confidence >= 0.3;
    }
    return true;
  });
}

export async function loadEditorialMemories(db: Queryable): Promise<EditorialMemory[]> {
  return activeMemories(await listLiveEditorialMemories(db, MEMORY_SCOPE));
}

export async function markMemoriesUsed(db: Queryable, memories: readonly EditorialMemory[]): Promise<void> {
  await markEditorialMemoriesUsed(db, memories.map((m) => m.memoryId));
}

// What the architect and writer receive. Confirmed memories are instructions;
// inferred ones are tentative; rejected ones are things never to reintroduce.
export function renderMemoriesForWriter(memories: readonly EditorialMemory[]): string {
  const confirmed = memories.filter((m) => m.status === 'CONFIRMED' || m.status === 'TEMPORARY');
  const inferred = memories.filter((m) => m.status === 'INFERRED');
  const experimental = memories.filter((m) => m.status === 'EXPERIMENTAL');
  const rejected = memories.filter((m) => m.status === 'REJECTED');
  if (memories.length === 0) return '';
  const line = (m: EditorialMemory): string => `- [${m.category}] ${m.statement}`;
  const blocks = [
    confirmed.length > 0 ? `Confirmed editorial preferences (follow these):\n${confirmed.map(line).join('\n')}` : null,
    inferred.length > 0 ? `Tentative patterns (lower weight; follow when they fit):\n${inferred.slice(0, 10).map(line).join('\n')}` : null,
    experimental.length > 0 ? `Experiments the editor is open to (optional):\n${experimental.slice(0, 5).map(line).join('\n')}` : null,
    rejected.length > 0
      ? `Rejected by the editor — these are NOT preferences; never act on or reintroduce them:\n${rejected.map((m) => `- ${m.statement}`).join('\n')}`
      : null,
  ].filter((b): b is string => b !== null);
  return `BLOG EDITORIAL MEMORY (what makes a successful Bull or Bear article, learned from past editing):\n${blocks.join('\n\n')}`;
}
