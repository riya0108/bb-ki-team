import { z } from 'zod';

import { EvidenceTierSchema, TemporalStatusSchema, VerificationStatusSchema } from './claim.js';

// Blog-specific editorial contracts (Agent 05 editorial upgrade). Everything here is
// additive to BLOG_PACKAGE (blogPackage.ts) and to the structured draft stored in
// content_items.package: older packages simply have none of these fields.

// ---------------------------------------------------------------------------
// Interactive components. The model returns these as plain-text data; the
// deterministic HTML builder (packages/agents/blog/src/htmlBuilder.ts) owns every
// tag, attribute and script. No field here may carry markup.
// ---------------------------------------------------------------------------

export const COMPONENT_TYPES = [
  'table',
  'revealCards',
  'quiz',
  'poll',
  'decision',
  'comparisonStat',
  'pullQuote',
  'timeline',
] as const;
export const ComponentTypeSchema = z.enum(COMPONENT_TYPES);
export type ComponentType = z.infer<typeof ComponentTypeSchema>;

// Spec 23: maximums, never requirements. pullQuote/comparisonStat keep the single
// slot the original draft contract had.
export const COMPONENT_LIMITS: Record<ComponentType, number> = {
  table: 1,
  revealCards: 1,
  quiz: 1,
  poll: 1,
  decision: 1,
  comparisonStat: 1,
  pullQuote: 1,
  timeline: 1,
};

// The most interactive (click-to-answer) widgets one article may carry in total, so
// a deep article is never turned into a game (spec 23).
export const MAX_INTERACTIVE_WIDGETS = 3;
export const INTERACTIVE_COMPONENT_TYPES: readonly ComponentType[] = ['revealCards', 'quiz', 'poll', 'decision'];

export const TABLE_KINDS = [
  'comparison',
  'timeline',
  'before_after',
  'country_comparison',
  'company_comparison',
  'metric_breakdown',
  'pros_cons',
  'bull_bear',
  'fact_interpretation',
  'scenario',
  'ranking',
  'process',
] as const;
export const TableKindSchema = z.enum(TABLE_KINDS);

const plain = z.string().trim();

export const TableColumnSchema = z.object({
  label: plain.min(1).max(80),
  align: z.enum(['left', 'right']).default('left'),
});

export const TableComponentSchema = z
  .object({
    kind: TableKindSchema.default('comparison'),
    title: plain.min(1).max(140),
    subtitle: plain.max(200).nullable().default(null),
    columns: z.array(TableColumnSchema).min(2).max(6),
    rows: z.array(z.array(plain.max(200)).min(2).max(6)).min(2).max(12),
    sourceNote: plain.min(1).max(300),
    footnote: plain.max(300).nullable().default(null),
    // Claim IDs every factual cell rests on (spec 18: every cell with a factual claim
    // traces to verified claims). Checked deterministically, see componentEvidence.ts.
    claimIds: z.array(z.string()).default([]),
    afterSectionIndex: z.number().int().min(0),
  })
  .refine((t) => t.rows.every((r) => r.length === t.columns.length), {
    message: 'every table row must have exactly one cell per column',
  });
export type TableComponent = z.infer<typeof TableComponentSchema>;

export const QUIZ_QUESTION_TYPES = ['multiple_choice', 'true_false', 'estimate', 'explanation', 'sequence', 'comparison'] as const;

export const QuizQuestionSchema = z
  .object({
    question: plain.min(1).max(240),
    type: z.enum(QUIZ_QUESTION_TYPES).default('multiple_choice'),
    options: z.array(plain.min(1).max(140)).min(2).max(4),
    // Exactly one correct answer, by construction: a single index into options.
    correctOptionIndex: z.number().int().min(0),
    explanation: plain.min(1).max(500),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    sourceNote: plain.max(200).nullable().default(null),
    claimIds: z.array(z.string()).default([]),
  })
  .refine((q) => q.correctOptionIndex < q.options.length, { message: 'correctOptionIndex must point at an option' })
  .refine((q) => new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length, {
    message: 'quiz options must be distinct',
  });
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizComponentSchema = z.object({
  title: plain.min(1).max(140),
  questions: z.array(QuizQuestionSchema).min(1).max(5),
  afterSectionIndex: z.number().int().min(0),
});
export type QuizComponent = z.infer<typeof QuizComponentSchema>;

export const DecisionOptionSchema = z.object({
  label: plain.min(1).max(140),
  revealTitle: plain.min(1).max(140),
  revealText: plain.min(1).max(600),
  evidenceNote: plain.max(240).nullable().default(null),
});

export const DecisionComponentSchema = z.object({
  title: plain.min(1).max(140),
  question: plain.min(1).max(300),
  options: z.array(DecisionOptionSchema).min(2).max(4),
  claimIds: z.array(z.string()).default([]),
  afterSectionIndex: z.number().int().min(0),
});
export type DecisionComponent = z.infer<typeof DecisionComponentSchema>;

export const TimelineEventSchema = z.object({
  date: plain.min(1).max(60),
  title: plain.min(1).max(140),
  description: plain.min(1).max(400),
  sourceNote: plain.max(200).nullable().default(null),
});

export const TimelineComponentSchema = z.object({
  title: plain.min(1).max(140),
  events: z.array(TimelineEventSchema).min(3).max(10),
  claimIds: z.array(z.string()).default([]),
  afterSectionIndex: z.number().int().min(0),
});
export type TimelineComponent = z.infer<typeof TimelineComponentSchema>;

// ---------------------------------------------------------------------------
// Editorial architecture: the outline produced before drafting (spec 24/36).
// ---------------------------------------------------------------------------

export const ArticleDepthSchema = z.enum(['short_explainer', 'standard', 'deep_analysis', 'investigation']);
export type ArticleDepth = z.infer<typeof ArticleDepthSchema>;

// Spec 13: ranges are guidance for completeness, never targets to pad towards.
export const DEPTH_WORD_RANGES: Record<ArticleDepth, [number, number]> = {
  short_explainer: [700, 1000],
  standard: [1200, 1800],
  deep_analysis: [1800, 3000],
  investigation: [2500, 4000],
};

export const SECTION_ROLES = [
  'basic_facts',
  'missing_question',
  'what_data_shows',
  'mechanism',
  'counterargument',
  'what_it_means',
  'what_to_watch',
  'context',
  'history',
  'comparison',
  'practical',
  'other',
] as const;
export const SectionRoleSchema = z.enum(SECTION_ROLES);

export const SectionPlanSchema = z.object({
  role: SectionRoleSchema.catch('other'),
  purpose: z.string().min(1),
  headingIdea: z.string().min(1),
  claimIds: z.array(z.string()).default([]),
});
export type SectionPlan = z.infer<typeof SectionPlanSchema>;

export const ComponentScoresSchema = z.object({
  informationGain: z.number().min(0).max(10),
  readerValue: z.number().min(0).max(10),
  topicFit: z.number().min(0).max(10),
  evidenceSupport: z.number().min(0).max(10),
  engagementValue: z.number().min(0).max(10),
  redundancy: z.number().min(0).max(10),
  editorialNecessity: z.number().min(0).max(10),
});
export type ComponentScores = z.infer<typeof ComponentScoresSchema>;

export const ComponentDecisionSchema = z.object({
  type: ComponentTypeSchema,
  decision: z.enum(['USE', 'DO_NOT_USE']),
  purpose: z.string(),
  scores: ComponentScoresSchema,
  total: z.number(),
  claimIds: z.array(z.string()).default([]),
  afterSectionIndex: z.number().int().min(0).nullable().default(null),
  reason: z.string(),
});
export type ComponentDecision = z.infer<typeof ComponentDecisionSchema>;

export const PriorCoverageDecisionSchema = z.enum(['new_article', 'new_angle', 'minor_update', 'major_update', 'no_update_needed']);
export type PriorCoverageDecision = z.infer<typeof PriorCoverageDecisionSchema>;

export const EditorialArchitectureSchema = z.object({
  thesis: z.string().min(1),
  primaryAngle: z.string().min(1),
  secondaryAngle: z.string().nullable().default(null),
  readerQuestion: z.string().min(1),
  hiddenMechanism: z.string().nullable().default(null),
  counterArgument: z.string().nullable().default(null),
  bullCase: z.string().nullable().default(null),
  bearCase: z.string().nullable().default(null),
  whatWeDontKnow: z.array(z.string()).default([]),
  keyFactClaimIds: z.array(z.string()).default([]),
  keyNumberClaimIds: z.array(z.string()).default([]),
  sectionPlan: z.array(SectionPlanSchema).default([]),
  articleDepth: ArticleDepthSchema,
  targetWordRange: z.tuple([z.number().int(), z.number().int()]),
  mustNotClaim: z.array(z.string()).default([]),
  componentDecisions: z.array(ComponentDecisionSchema).default([]),
  priorCoverageDecision: PriorCoverageDecisionSchema.default('new_article'),
  editorialConfidence: z.number().min(0).max(1),
  // Whether the architecture came from the planner model or the deterministic
  // fallback (planner unavailable) — surfaced to the reviewer.
  source: z.enum(['planner', 'fallback']).default('planner'),
});
export type EditorialArchitecture = z.infer<typeof EditorialArchitectureSchema>;

// ---------------------------------------------------------------------------
// Editorial critic scores (spec 25/36). 0-10 each; aiSlopRiskScore is "lower is
// better", everything else "higher is better".
// ---------------------------------------------------------------------------

export const EditorialQualitySchema = z.object({
  originalityScore: z.number().min(0).max(10),
  informationDensityScore: z.number().min(0).max(10),
  factualGroundingScore: z.number().min(0).max(10),
  narrativeFlowScore: z.number().min(0).max(10),
  humanVoiceScore: z.number().min(0).max(10),
  clarityScore: z.number().min(0).max(10),
  depthScore: z.number().min(0).max(10),
  curiosityScore: z.number().min(0).max(10),
  readerUtilityScore: z.number().min(0).max(10),
  brandFitScore: z.number().min(0).max(10),
  evidenceQualityScore: z.number().min(0).max(10),
  counterArgumentScore: z.number().min(0).max(10),
  interactiveUsefulnessScore: z.number().min(0).max(10),
  seoQualityScore: z.number().min(0).max(10),
  aiSlopRiskScore: z.number().min(0).max(10),
});
export type EditorialQuality = z.infer<typeof EditorialQualitySchema>;

// Hard thresholds live in a zod-free module so the dashboard can import them without
// bundling the schema library.
export { EDITORIAL_HARD_THRESHOLDS } from './editorialThresholds.js';

export const EditorialWarningSchema = z.object({
  code: z.string(),
  severity: z.enum(['info', 'warn', 'block']),
  message: z.string(),
});
export type EditorialWarning = z.infer<typeof EditorialWarningSchema>;

export const InternalLinkSchema = z.object({
  anchorText: z.string().min(1),
  targetContentId: z.string().uuid(),
  targetTitle: z.string(),
  targetSlug: z.string(),
  targetUrl: z.string().url(),
  reason: z.string(),
});
export type InternalLink = z.infer<typeof InternalLinkSchema>;

export const SeoPlanSchema = z.object({
  primaryKeyword: z.string().nullable().default(null),
  secondaryKeywords: z.array(z.string()).default([]),
  searchIntent: z.enum(['informational', 'navigational', 'commercial', 'transactional', 'news']).catch('informational'),
  relatedTopics: z.array(z.string()).default([]),
});
export type SeoPlan = z.infer<typeof SeoPlanSchema>;

// A safe editorial learning signal derived from the draft (or a human edit) — the
// pattern, never copied text (spec 45).
export const StyleMemorySignalSchema = z.object({
  subject: z.string(),
  polarity: z.enum(['prefer', 'avoid']),
  statement: z.string(),
});
export type StyleMemorySignal = z.infer<typeof StyleMemorySignalSchema>;

// ---------------------------------------------------------------------------
// Claim ledger view (spec 5): a derived, reviewer-facing projection of an
// EditorialBrief's claims + sources. Never stored separately from the brief — it is
// recomputed deterministically so it can never disagree with the verified ledger.
// ---------------------------------------------------------------------------

export const AllowedUseSchema = z.enum(['state_as_fact', 'attribute', 'hedge_as_uncertain', 'do_not_use']);
export type AllowedUse = z.infer<typeof AllowedUseSchema>;

export const ClaimLedgerEntrySchema = z.object({
  claimId: z.string(),
  exactClaim: z.string(),
  normalizedClaim: z.string(),
  claimType: z.string(),
  sourceIds: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  sourceTier: EvidenceTierSchema.nullable(),
  independentSourceCount: z.number().int().nonnegative(),
  publicationDate: z.string().nullable(),
  evidenceDate: z.string().nullable(),
  confidence: z.number(),
  verificationStatus: VerificationStatusSchema,
  contradictionStatus: z.enum(['none', 'conflicts', 'disputed']),
  temporalStatus: TemporalStatusSchema,
  temporalQualifier: z.string().nullable(),
  geography: z.string().nullable(),
  entity: z.string().nullable(),
  numericalValue: z.number().nullable(),
  unit: z.string().nullable(),
  currency: z.string().nullable(),
  originalSource: z.string().nullable(),
  supportingQuote: z.string().nullable(),
  allowedUse: AllowedUseSchema,
  caveat: z.string().nullable(),
  lastVerifiedAt: z.string(),
});
export type ClaimLedgerEntry = z.infer<typeof ClaimLedgerEntrySchema>;

// ---------------------------------------------------------------------------
// Blog Editorial Memory (spec 8/9). Persistent, deduplicated editorial patterns —
// distinct from Content DNA (who the creator is) and from learning_events (the raw
// signal log): this is what makes a successful Bull or Bear *article*.
// ---------------------------------------------------------------------------

export const MemoryStatusSchema = z.enum(['CONFIRMED', 'INFERRED', 'REJECTED', 'TEMPORARY', 'EXPERIMENTAL']);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemoryCategorySchema = z.enum(['structure', 'language', 'editorial', 'quality']);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const MemorySourceSchema = z.enum(['explicit_feedback', 'edit_diff', 'approval', 'rejection', 'revision_instruction', 'performance', 'reference']);
export type MemorySource = z.infer<typeof MemorySourceSchema>;

export const EditorialMemorySchema = z.object({
  memoryId: z.string().uuid(),
  category: MemoryCategorySchema,
  // Normalized key ("component:quiz", "opening:question_led", "custom:...") used to
  // deduplicate and to detect a newer memory superseding an older opposite one.
  subject: z.string().min(1),
  polarity: z.enum(['prefer', 'avoid']),
  statement: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: MemorySourceSchema,
  status: MemoryStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUsedAt: z.string().nullable(),
  timesConfirmed: z.number().int().nonnegative(),
  timesRejected: z.number().int().nonnegative(),
  validUntil: z.string().nullable(),
  supersededById: z.string().uuid().nullable(),
  // Audit trail: which content items / signals produced or reinforced this memory.
  evidence: z.array(z.object({ contentId: z.string().nullable(), signal: z.string(), at: z.string() })).default([]),
});
export type EditorialMemory = z.infer<typeof EditorialMemorySchema>;

// ---------------------------------------------------------------------------
// Blog Style Profile (spec 10/11): measurable traits, aggregated from abstracted
// style samples (approved Bull or Bear articles + approved references). Samples never
// store article text, only metrics and short abstract trait labels.
// ---------------------------------------------------------------------------

export const StyleMetricsSchema = z.object({
  wordCount: z.number().nonnegative(),
  openingWordCount: z.number().nonnegative(),
  openingStyle: z.enum(['question', 'statistic', 'anecdote', 'tension', 'event', 'contrast', 'other']),
  avgSentenceWords: z.number().nonnegative(),
  avgParagraphWords: z.number().nonnegative(),
  shortParagraphRatio: z.number().min(0).max(1),
  h2Count: z.number().nonnegative(),
  questionH2Ratio: z.number().min(0).max(1),
  numbersPer1000Words: z.number().nonnegative(),
  questionsPer1000Words: z.number().nonnegative(),
  tableCount: z.number().nonnegative(),
  componentCount: z.number().nonnegative(),
  bulletLineRatio: z.number().min(0).max(1),
  endingStyle: z.enum(['synthesis', 'implication', 'question', 'prediction', 'action', 'uncomfortable_observation', 'other']),
});
export type StyleMetrics = z.infer<typeof StyleMetricsSchema>;

export const StyleTraitsSchema = z.object({
  openingTechnique: z.string().nullable().default(null),
  transitionPatterns: z.array(z.string()).default([]),
  conclusionPattern: z.string().nullable().default(null),
  evidenceUse: z.string().nullable().default(null),
  narrativeUse: z.string().nullable().default(null),
  conversationality: z.number().min(0).max(10).nullable().default(null),
  editorialDepth: z.number().min(0).max(10).nullable().default(null),
  directness: z.number().min(0).max(10).nullable().default(null),
  skepticism: z.number().min(0).max(10).nullable().default(null),
  warmth: z.number().min(0).max(10).nullable().default(null),
  formality: z.number().min(0).max(10).nullable().default(null),
});
export type StyleTraits = z.infer<typeof StyleTraitsSchema>;

export const StyleSampleKindSchema = z.enum(['approved_article', 'own_published', 'approved_reference', 'user_supplied']);
export type StyleSampleKind = z.infer<typeof StyleSampleKindSchema>;

export const StyleSampleSchema = z.object({
  id: z.string().uuid(),
  kind: StyleSampleKindSchema,
  label: z.string(),
  sourceUrl: z.string().nullable(),
  contentId: z.string().uuid().nullable(),
  metrics: StyleMetricsSchema,
  traits: StyleTraitsSchema,
  active: z.boolean(),
  createdAt: z.string(),
});
export type StyleSample = z.infer<typeof StyleSampleSchema>;

export const BlogStyleProfileSchema = z.object({
  sampleCount: z.number().int().nonnegative(),
  ownArticleCount: z.number().int().nonnegative(),
  referenceCount: z.number().int().nonnegative(),
  metrics: StyleMetricsSchema.extend({
    openingStyleDistribution: z.record(z.string(), z.number()),
    endingStyleDistribution: z.record(z.string(), z.number()),
  }).nullable(),
  traits: z.object({
    openingTechniques: z.array(z.string()),
    transitionPatterns: z.array(z.string()),
    conclusionPatterns: z.array(z.string()),
    voice: z.record(z.string(), z.number()),
  }),
});
export type BlogStyleProfile = z.infer<typeof BlogStyleProfileSchema>;

// ---------------------------------------------------------------------------
// Article reuse / refresh (spec 47/48).
// ---------------------------------------------------------------------------

export const PriorArticleMatchSchema = z.object({
  contentId: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  status: z.string(),
  thesis: z.string().nullable(),
  createdAt: z.string(),
  similarity: z.number().min(0).max(1),
});
export type PriorArticleMatch = z.infer<typeof PriorArticleMatchSchema>;

export const CoverageCheckSchema = z.object({
  status: z.enum(['new_topic', 'previously_covered']),
  matches: z.array(PriorArticleMatchSchema).default([]),
});
export type CoverageCheck = z.infer<typeof CoverageCheckSchema>;
