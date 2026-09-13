import { z } from 'zod';

const RawEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
});

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
}

export interface Env {
  databaseUrl: string;
  apiPort: number;
  gemini?: LlmProviderConfig | undefined;
  groq?: LlmProviderConfig | undefined;
  openrouter?: LlmProviderConfig | undefined;
}

export class EnvValidationError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

function providerConfig(apiKey: string | undefined, model: string | undefined): LlmProviderConfig | undefined {
  if (!apiKey) return undefined;
  if (!model) return undefined;
  return { apiKey, model };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = RawEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }

  const raw = parsed.data;
  const gemini = providerConfig(raw.GEMINI_API_KEY, raw.GEMINI_MODEL);
  const groq = providerConfig(raw.GROQ_API_KEY, raw.GROQ_MODEL);
  const openrouter = providerConfig(raw.OPENROUTER_API_KEY, raw.OPENROUTER_MODEL);

  if (!gemini && !groq && !openrouter) {
    throw new EnvValidationError([
      'at least one LLM provider must be configured (GEMINI_API_KEY+GEMINI_MODEL, GROQ_API_KEY+GROQ_MODEL, or OPENROUTER_API_KEY+OPENROUTER_MODEL)',
    ]);
  }

  return {
    databaseUrl: raw.DATABASE_URL,
    apiPort: raw.API_PORT,
    gemini,
    groq,
    openrouter,
  };
}
