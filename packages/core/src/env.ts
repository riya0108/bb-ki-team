import type { z } from 'zod';

/**
 * Parses and validates process.env against a Zod schema. Config/secrets must
 * come from environment variables per CLAUDE.md — this is the single
 * enforcement point so a missing/malformed var fails fast with a clear error
 * instead of surfacing as an obscure downstream failure.
 */
export function loadEnv<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<Shape>> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
