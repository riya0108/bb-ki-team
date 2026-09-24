import { describe, expect, it } from 'vitest';

import { InstagramPackageSchema } from './instagramPackage.js';

const common = {
  contentId: '11111111-1111-4111-8111-111111111111',
  status: 'in_review' as const,
  contentDnaVersion: 1,
  sourceReferences: [],
  approvalRequired: true as const,
  publishAction: 'none' as const,
};

describe('InstagramPackageSchema', () => {
  it('accepts a valid post package', () => {
    const post = {
      format: 'post' as const,
      ...common,
      concept: 'A concept',
      visualDirection: 'A visual',
      coverText: 'Cover text',
      headline: 'Headline',
      caption: 'Caption',
      firstLineHook: 'Hook',
      cta: null,
      hashtagsOptional: [],
      altText: 'Alt text',
      designNotes: 'Notes',
    };
    expect(InstagramPackageSchema.safeParse(post).success).toBe(true);
  });

  it('accepts a valid carousel package with slides', () => {
    const carousel = {
      format: 'carousel' as const,
      ...common,
      title: 'Title',
      coverHook: 'Cover hook',
      slideCount: 2,
      slides: [
        { number: 1, headline: 'Slide 1', body: 'Body 1', visualDirection: 'Visual 1', sourceNote: null },
        { number: 2, headline: 'Slide 2', body: 'Body 2', visualDirection: 'Visual 2', sourceNote: null },
      ],
      caption: 'Caption',
      cta: null,
      altText: 'Alt text',
      designSystem: 'System',
    };
    expect(InstagramPackageSchema.safeParse(carousel).success).toBe(true);
  });

  it('accepts a valid reel package', () => {
    const reel = {
      format: 'reel' as const,
      ...common,
      concept: 'A concept',
      hook: 'A hook',
      spokenScript: 'Script',
      onScreenText: ['text'],
      sceneByScene: ['scene 1'],
      bRoll: [],
      visualProof: null,
      pacingNotes: null,
      caption: 'Caption',
      coverText: 'Cover',
      cta: null,
      audioNoteOptional: null,
      editingNotes: null,
      factSources: [],
    };
    expect(InstagramPackageSchema.safeParse(reel).success).toBe(true);
  });

  it('rejects an unknown format', () => {
    const result = InstagramPackageSchema.safeParse({ format: 'story', ...common });
    expect(result.success).toBe(false);
  });

  it('rejects a carousel with zero slides', () => {
    const result = InstagramPackageSchema.safeParse({
      format: 'carousel',
      ...common,
      title: 'Title',
      coverHook: 'Hook',
      slideCount: 0,
      slides: [],
      caption: 'Caption',
      cta: null,
      altText: 'Alt',
      designSystem: 'System',
    });
    expect(result.success).toBe(false);
  });

  it('defaults visualAssetId to null when omitted, for text-only regression', () => {
    const post = {
      format: 'post' as const,
      ...common,
      concept: 'A concept',
      visualDirection: 'A visual',
      coverText: 'Cover text',
      headline: 'Headline',
      caption: 'Caption',
      firstLineHook: 'Hook',
      cta: null,
      hashtagsOptional: [],
      altText: 'Alt text',
      designNotes: 'Notes',
    };
    const result = InstagramPackageSchema.safeParse(post);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.visualAssetId).toBeNull();
  });
});
