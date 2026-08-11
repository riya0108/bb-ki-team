import { z } from 'zod';
import { BlogCategorySlugSchema, type BlogCategorySlug } from '@ai-company/shared-types';
import { generateStructured, type LlmProviderConfig } from '@ai-company/core';

const ClassificationSchema = z.object({ category: BlogCategorySlugSchema });

/** Classifies the approved topic into one of the site's fixed, existing category slugs. */
export async function classifyCategory(
  providers: LlmProviderConfig[],
  topic: string,
  excerpt: string,
): Promise<BlogCategorySlug> {
  const result = await generateStructured({
    providers,
    toolName: 'category_classification',
    schema: ClassificationSchema,
    system:
      'You classify a blog post into exactly one of these fixed categories: ai, tech, money, ' +
      'finance, politics, personal-finance, world, business, lifestyle. Pick the single best fit — ' +
      'never invent a category outside this list.',
    prompt: `Topic: "${topic}"\nExcerpt: "${excerpt}"\n\nWhich category?`,
  });
  return result.category;
}
