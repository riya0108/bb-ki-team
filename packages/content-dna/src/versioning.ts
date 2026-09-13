import type { ContentDnaBody, ContentDnaDraft, ContentDnaRecord } from '@bb/shared-types';
import { ContentDnaBodySchema } from '@bb/shared-types';
import type { Pool, Queryable } from '@bb/db';
import {
  getActiveContentDna,
  getMaxDnaVersion,
  insertContentDna,
  supersedeActiveContentDna,
  withTransaction,
} from '@bb/db';

import { InvalidDnaDraftError, NoActiveDnaError } from './errors.js';

export async function loadCurrentDna(db: Queryable): Promise<ContentDnaRecord> {
  const record = await getActiveContentDna(db);
  if (!record) throw new NoActiveDnaError();
  return record;
}

// Fills in defaults for everything that's genuinely optional/defaultable in
// ContentDnaBodySchema. identity.role, identity.audiencePrimary, and voice.tone have
// no default in the schema — spec 3.4 treats these as the load-bearing identity facts,
// so a draft missing any of them is a real validation failure, not something to paper
// over with an empty string.
export function draftToBody(draft: ContentDnaDraft): ContentDnaBody {
  const role = draft.identity?.role;
  const audiencePrimary = draft.identity?.audiencePrimary;
  const tone = draft.voice?.tone;

  const missing: string[] = [];
  if (!role) missing.push('identity.role');
  if (!audiencePrimary) missing.push('identity.audiencePrimary');
  if (!tone) missing.push('voice.tone');
  if (missing.length > 0) throw new InvalidDnaDraftError(missing);

  return ContentDnaBodySchema.parse({
    identity: {
      role,
      expertise: draft.identity?.expertise ?? [],
      audiencePrimary,
      audienceSecondary: draft.identity?.audienceSecondary,
    },
    topics: draft.topics ?? { primary: [], secondary: [], avoid: [] },
    opinions: draft.opinions ?? { stronglyHeld: [], nuanced: [], evolving: [], unknown: [] },
    voice: {
      tone,
      energy: draft.voice?.energy,
      formality: draft.voice?.formality,
      humour: draft.voice?.humour,
      directness: draft.voice?.directness,
      sentenceRhythm: draft.voice?.sentenceRhythm,
      paragraphRhythm: draft.voice?.paragraphRhythm,
      vocabulary: draft.voice?.vocabulary ?? [],
      preferredPhrases: draft.voice?.preferredPhrases ?? [],
      forbiddenPhrases: draft.voice?.forbiddenPhrases ?? [],
    },
    storytelling: draft.storytelling ?? { hookPatterns: [], analogyPatterns: [], ctaPatterns: [] },
    personalContext:
      draft.personalContext ?? { approvedStories: [], approvedExperiences: [], sensitiveOrPrivate: [] },
    platformPreferences: draft.platformPreferences ?? {},
    learning: {
      confirmedPreferences: [],
      inferredPreferences: [],
      pendingQuestions: draft.pendingQuestions,
    },
  });
}

// Atomic: supersedes whatever was active (if anything) and inserts the new version in
// one transaction, so there is never a moment with zero or two active versions visible
// to a concurrent reader. Never mutates an existing version in place (spec 3.4).
export async function confirmDna(pool: Pool, draft: ContentDnaDraft, confirmedBy: string): Promise<ContentDnaRecord> {
  const body = draftToBody(draft);
  return withTransaction(pool, async (client) => {
    const maxVersion = await getMaxDnaVersion(client);
    await supersedeActiveContentDna(client);
    return insertContentDna(client, { version: maxVersion + 1, status: 'active', body, confirmedBy });
  });
}
