import { z } from 'zod';

export const DnaStatusSchema = z.enum(['draft', 'active', 'superseded']);
export type DnaStatus = z.infer<typeof DnaStatusSchema>;

export const ContentDnaIdentitySchema = z.object({
  role: z.string(),
  expertise: z.array(z.string()).default([]),
  audiencePrimary: z.string(),
  audienceSecondary: z.string().optional(),
});
export type ContentDnaIdentity = z.infer<typeof ContentDnaIdentitySchema>;

export const ContentDnaTopicsSchema = z.object({
  primary: z.array(z.string()).default([]),
  secondary: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
});
export type ContentDnaTopics = z.infer<typeof ContentDnaTopicsSchema>;

export const ContentDnaOpinionsSchema = z.object({
  stronglyHeld: z.array(z.string()).default([]),
  nuanced: z.array(z.string()).default([]),
  evolving: z.array(z.string()).default([]),
  unknown: z.array(z.string()).default([]),
});
export type ContentDnaOpinions = z.infer<typeof ContentDnaOpinionsSchema>;

export const ContentDnaVoiceSchema = z.object({
  tone: z.string(),
  energy: z.string().optional(),
  formality: z.string().optional(),
  humour: z.string().optional(),
  directness: z.string().optional(),
  sentenceRhythm: z.string().optional(),
  paragraphRhythm: z.string().optional(),
  vocabulary: z.array(z.string()).default([]),
  preferredPhrases: z.array(z.string()).default([]),
  forbiddenPhrases: z.array(z.string()).default([]),
});
export type ContentDnaVoice = z.infer<typeof ContentDnaVoiceSchema>;

export const ContentDnaStorytellingSchema = z.object({
  hookPatterns: z.array(z.string()).default([]),
  analogyPatterns: z.array(z.string()).default([]),
  evidenceStyle: z.string().optional(),
  conclusionStyle: z.string().optional(),
  ctaPatterns: z.array(z.string()).default([]),
});
export type ContentDnaStorytelling = z.infer<typeof ContentDnaStorytellingSchema>;

export const ContentDnaPersonalContextSchema = z.object({
  approvedStories: z.array(z.string()).default([]),
  approvedExperiences: z.array(z.string()).default([]),
  sensitiveOrPrivate: z.array(z.string()).default([]),
});
export type ContentDnaPersonalContext = z.infer<typeof ContentDnaPersonalContextSchema>;

export const ContentDnaPlatformPreferencesSchema = z.object({
  linkedin: z.string().optional(),
  x: z.string().optional(),
  instagram: z.string().optional(),
  youtubeShorts: z.string().optional(),
  blog: z.string().optional(),
});
export type ContentDnaPlatformPreferences = z.infer<typeof ContentDnaPlatformPreferencesSchema>;

export const ContentDnaLearningSchema = z.object({
  confirmedPreferences: z.array(z.string()).default([]),
  inferredPreferences: z.array(z.string()).default([]),
  pendingQuestions: z.array(z.string()).default([]),
});
export type ContentDnaLearning = z.infer<typeof ContentDnaLearningSchema>;

export const ContentDnaBodySchema = z.object({
  identity: ContentDnaIdentitySchema,
  topics: ContentDnaTopicsSchema,
  opinions: ContentDnaOpinionsSchema,
  voice: ContentDnaVoiceSchema,
  storytelling: ContentDnaStorytellingSchema,
  personalContext: ContentDnaPersonalContextSchema,
  platformPreferences: ContentDnaPlatformPreferencesSchema,
  learning: ContentDnaLearningSchema,
});
export type ContentDnaBody = z.infer<typeof ContentDnaBodySchema>;

export const ContentDnaRecordSchema = ContentDnaBodySchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: DnaStatusSchema,
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  confirmedBy: z.string().nullable(),
});
export type ContentDnaRecord = z.infer<typeof ContentDnaRecordSchema>;

// Draft shape used during onboarding, before the user confirms it into a version.
// Every leaf is optional/defaulted so a partially-built draft still parses.
export const ContentDnaDraftSchema = z.object({
  identity: ContentDnaIdentitySchema.partial({ role: true }).optional(),
  topics: ContentDnaTopicsSchema.optional(),
  opinions: ContentDnaOpinionsSchema.optional(),
  voice: ContentDnaVoiceSchema.partial({ tone: true }).optional(),
  storytelling: ContentDnaStorytellingSchema.optional(),
  personalContext: ContentDnaPersonalContextSchema.optional(),
  platformPreferences: ContentDnaPlatformPreferencesSchema.optional(),
  pendingQuestions: z.array(z.string()).default([]),
});
export type ContentDnaDraft = z.infer<typeof ContentDnaDraftSchema>;
