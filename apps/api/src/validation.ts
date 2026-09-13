import type { z } from 'zod';

export class ValidationError extends Error {
  constructor(issues: string) {
    super(`Invalid request: ${issues}`);
    this.name = 'ValidationError';
  }
}

// Every external input crossing into this process (request body or query) is
// validated with Zod before touching any agent/db code (CLAUDE.md).
export function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new ValidationError(result.error.message);
  return result.data;
}
