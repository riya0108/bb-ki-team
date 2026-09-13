import { z } from 'zod';

import { ContentStatusSchema } from './contentItem.js';
import { PublishActionSchema } from './publishAction.js';

// spec section 7.1's routing outcome — which of the three specialists (03A/03B/03C)
// produced this package. Distinct from AgentModeSchema (how the idea originated).
export const InstagramFormatSchema = z.enum(['post', 'carousel', 'reel']);
export type InstagramFormat = z.infer<typeof InstagramFormatSchema>;

const commonFields = {
  contentId: z.string().uuid(),
  status: ContentStatusSchema,
  contentDnaVersion: z.number().int().positive(),
  sourceReferences: z.array(z.string()).default([]),
  approvalRequired: z.literal(true),
  publishAction: PublishActionSchema,
};

// Mirrors INSTAGRAM_POST, spec section 8.2.
export const InstagramPostSchema = z.object({
  format: z.literal('post'),
  ...commonFields,
  concept: z.string(),
  visualDirection: z.string(),
  coverText: z.string(),
  headline: z.string(),
  caption: z.string(),
  firstLineHook: z.string(),
  cta: z.string().nullable(),
  hashtagsOptional: z.array(z.string()).default([]),
  altText: z.string(),
  designNotes: z.string(),
});
export type InstagramPost = z.infer<typeof InstagramPostSchema>;

// Mirrors one row of the `slides` array, spec section 9.3.
export const InstagramCarouselSlideSchema = z.object({
  number: z.number().int().positive(),
  headline: z.string(),
  body: z.string(),
  visualDirection: z.string(),
  sourceNote: z.string().nullable(),
});
export type InstagramCarouselSlide = z.infer<typeof InstagramCarouselSlideSchema>;

// Mirrors INSTAGRAM_CAROUSEL, spec section 9.3.
export const InstagramCarouselSchema = z.object({
  format: z.literal('carousel'),
  ...commonFields,
  title: z.string(),
  coverHook: z.string(),
  slideCount: z.number().int().positive(),
  slides: z.array(InstagramCarouselSlideSchema).min(1),
  caption: z.string(),
  cta: z.string().nullable(),
  altText: z.string(),
  designSystem: z.string(),
});
export type InstagramCarousel = z.infer<typeof InstagramCarouselSchema>;

// Mirrors INSTAGRAM_REEL, spec section 10.3.
export const InstagramReelSchema = z.object({
  format: z.literal('reel'),
  ...commonFields,
  concept: z.string(),
  hook: z.string(),
  spokenScript: z.string(),
  onScreenText: z.array(z.string()).default([]),
  sceneByScene: z.array(z.string()).min(1),
  bRoll: z.array(z.string()).default([]),
  visualProof: z.string().nullable(),
  pacingNotes: z.string().nullable(),
  caption: z.string(),
  coverText: z.string(),
  cta: z.string().nullable(),
  audioNoteOptional: z.string().nullable(),
  editingNotes: z.string().nullable(),
  factSources: z.array(z.string()).default([]),
});
export type InstagramReel = z.infer<typeof InstagramReelSchema>;

export const InstagramPackageSchema = z.discriminatedUnion('format', [
  InstagramPostSchema,
  InstagramCarouselSchema,
  InstagramReelSchema,
]);
export type InstagramPackage = z.infer<typeof InstagramPackageSchema>;
