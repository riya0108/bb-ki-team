import type { ContentDnaDraft } from '@bb/shared-types';
import { describe, expect, it } from 'vitest';

import { InvalidDnaDraftError } from './errors.js';
import { draftToBody } from './versioning.js';

describe('draftToBody', () => {
  it('throws InvalidDnaDraftError when identity.role, identity.audiencePrimary, or voice.tone are missing', () => {
    const missingRole: ContentDnaDraft = {
      identity: { audiencePrimary: 'x', expertise: [] },
      voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
      pendingQuestions: [],
    };
    expect(() => draftToBody(missingRole)).toThrow(InvalidDnaDraftError);

    const missingTone: ContentDnaDraft = {
      identity: { role: 'Founder', audiencePrimary: 'x', expertise: [] },
      pendingQuestions: [],
    };
    expect(() => draftToBody(missingTone)).toThrow(InvalidDnaDraftError);

    const missingEverything: ContentDnaDraft = { pendingQuestions: [] };
    expect(() => draftToBody(missingEverything)).toThrow(/identity\.role.*identity\.audiencePrimary.*voice\.tone/s);
  });

  it('defaults everything else that is genuinely optional', () => {
    const draft: ContentDnaDraft = {
      identity: { role: 'Founder', audiencePrimary: 'Indian professionals', expertise: [] },
      voice: { tone: 'sharp', vocabulary: [], preferredPhrases: [], forbiddenPhrases: [] },
      pendingQuestions: ['what topics should I avoid?'],
    };
    const body = draftToBody(draft);
    expect(body.topics).toEqual({ primary: [], secondary: [], avoid: [] });
    expect(body.learning.pendingQuestions).toEqual(['what topics should I avoid?']);
  });
});
