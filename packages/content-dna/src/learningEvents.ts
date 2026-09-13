import type {
  ContentDnaBody,
  ContentDnaRecord,
  LearningEvent,
  LearningStrength,
  NewLearningEventInput,
} from '@bb/shared-types';
import type { Pool, Queryable } from '@bb/db';
import { getLearningEventById, insertLearningEvent, markLearningEventApplied } from '@bb/db';

import { LearningEventNotFoundError, WeakLearningSignalError } from './errors.js';
import { confirmDna, loadCurrentDna } from './versioning.js';

export async function recordLearningEvent(
  db: Queryable,
  input: NewLearningEventInput & { strength: LearningStrength },
): Promise<LearningEvent> {
  return insertLearningEvent(db, input);
}

const QUALIFYING_STRENGTHS: ReadonlySet<LearningStrength> = new Set(['very_strong', 'strong']);

// Shallow, one-level-deep merge: for each top-level DNA section present in the
// proposed change, its own keys overwrite the current DNA's (arrays are replaced
// wholesale, not concatenated) — this keeps merge semantics predictable and avoids
// silently duplicating list entries across repeated learning events.
function mergeProposedChange(current: ContentDnaBody, proposedChange: Record<string, unknown>): ContentDnaBody {
  const merged: Record<string, unknown> = { ...current };
  for (const [section, patch] of Object.entries(proposedChange)) {
    const currentSection = (current as Record<string, unknown>)[section];
    if (
      patch &&
      typeof patch === 'object' &&
      !Array.isArray(patch) &&
      currentSection &&
      typeof currentSection === 'object' &&
      !Array.isArray(currentSection)
    ) {
      merged[section] = { ...currentSection, ...patch };
    } else {
      merged[section] = patch;
    }
  }
  return merged as unknown as ContentDnaBody;
}

// Refuses anything weaker than "strong" (spec 3.4: a signal becomes a DNA change only
// when deliberate or repeated). Loads the CURRENT active DNA, merges the proposed
// change on top of it, and confirms a brand-new version via confirmDna — it never
// mutates the existing version in place. The read-event -> confirm-new-version step
// runs as one atomic transaction inside confirmDna; marking the event applied is a
// separate fast-follow call rather than being folded into that same transaction. If
// the process crashes between the two, the DNA change is still correctly applied and
// only the event's applied_to_dna bookkeeping could be stale — an acceptable,
// self-evident gap for Phase 1's single-user scale, versus the alternative of forcing
// packages/db to expose a bespoke cross-table transaction just for this one path.
export async function confirmDnaChange(pool: Pool, eventId: string, confirmedBy: string): Promise<ContentDnaRecord> {
  const event = await getLearningEventById(pool, eventId);
  if (!event) throw new LearningEventNotFoundError(eventId);
  if (!QUALIFYING_STRENGTHS.has(event.strength)) {
    throw new WeakLearningSignalError(event.strength);
  }

  const current = await loadCurrentDna(pool);
  const proposedChange = event.proposedChange ?? {};
  const mergedBody = mergeProposedChange(current, proposedChange);

  const newVersion = await confirmDna(
    pool,
    {
      identity: mergedBody.identity,
      topics: mergedBody.topics,
      opinions: mergedBody.opinions,
      voice: mergedBody.voice,
      storytelling: mergedBody.storytelling,
      personalContext: mergedBody.personalContext,
      platformPreferences: mergedBody.platformPreferences,
      pendingQuestions: mergedBody.learning.pendingQuestions,
    },
    confirmedBy,
  );

  await markLearningEventApplied(pool, eventId, newVersion.version);
  return newVersion;
}
