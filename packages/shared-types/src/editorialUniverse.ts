import { z } from 'zod';

/**
 * Matches the live site's fixed category set exactly
 * (`~/Downloads/BLOG/src/content/categories.json`) — a Blog Topic Finder
 * candidate that can't be mapped onto one of these will fail publishing
 * later, so the enum is deliberately this narrow rather than the user's
 * broader aspirational taxonomy.
 */
export const EditorialCategorySchema = z.enum([
  'ai',
  'tech',
  'money',
  'finance',
  'politics',
  'personal-finance',
  'world',
  'business',
  'lifestyle',
]);
export type EditorialCategory = z.infer<typeof EditorialCategorySchema>;

export interface EditorialCategoryProfile {
  category: EditorialCategory;
  /**
   * A relative weight (not required to sum to 100) used only to bias which
   * categories the candidate-generation step spends its search budget on —
   * never a hard filter. Static defaults for now; feature #4/#42
   * (performance-driven reweighting) is deferred until real post analytics
   * exist (see packages/shared-types/src/contentIntelligence.ts).
   */
  weight: number;
  /** Seed subtopics from the user's editorial universe spec — bias, not constraint. */
  subtopics: string[];
}

export const EDITORIAL_UNIVERSE: EditorialCategoryProfile[] = [
  {
    category: 'ai',
    weight: 18,
    subtopics: [
      'AI agents',
      'generative AI',
      'AI companies',
      'AI jobs',
      'AI regulation',
      'AI economics',
      'AI tools',
      'AI risks',
      'AI + finance',
      'AI + business',
      'AI + society',
    ],
  },
  { category: 'finance', weight: 16, subtopics: ['stock market', 'economy', 'interest rates', 'inflation', 'bonds', 'commodities', 'crypto', 'investing', 'global markets'] },
  {
    category: 'personal-finance',
    weight: 15,
    subtopics: ['saving', 'investing', 'taxes', 'insurance', 'loans', 'budgeting', 'financial mistakes', 'wealth building', 'FIRE', 'credit cards', 'rewards', 'cashback', 'credit score', 'card comparisons', 'hidden charges', 'bank strategies'],
  },
  { category: 'business', weight: 12, subtopics: ['companies', 'startups', 'business models', 'corporate strategy', 'M&A', 'entrepreneurship', 'market disruption', 'corporate failures'] },
  { category: 'tech', weight: 10, subtopics: ['smartphones', 'software', 'cybersecurity', 'robotics', 'cloud', 'chips', 'internet', 'big tech', 'emerging technology', 'gadgets', 'wearables', 'laptops', 'smart home'] },
  { category: 'money', weight: 7, subtopics: ['money psychology', 'wealth', 'consumer spending', 'inflation', 'financial behavior', 'money myths'] },
  { category: 'politics', weight: 5, subtopics: ['policy', 'elections', 'government decisions', 'economic consequences', 'geopolitics', 'political strategy', 'policy impact', 'India + world'] },
  { category: 'world', weight: 5, subtopics: ['geopolitics', 'global economy', 'wars/conflicts', 'international trade', 'energy', 'global technology', 'demographics', 'major global shifts'] },
  { category: 'lifestyle', weight: 4, subtopics: ['consumer behavior', 'spending', 'work', 'productivity', 'travel', 'psychology', 'social trends', 'digital lifestyle'] },
];

export function editorialCategoryWeight(category: EditorialCategory): number {
  return EDITORIAL_UNIVERSE.find((p) => p.category === category)?.weight ?? 1;
}
