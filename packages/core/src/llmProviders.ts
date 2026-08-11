import { z } from 'zod';
import { loadEnv } from './env.js';
import type { LlmProviderConfig } from './llm.js';

const ProviderEnvSchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-flash-latest'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('nvidia/nemotron-3-super-120b-a12b:free'),
});

/**
 * Builds the ordered LLM provider fallback chain — Gemini (primary), Groq
 * (fallback), OpenRouter (further fallback) — skipping any provider whose
 * API key isn't set, same "skip gracefully" convention as the search MCP
 * servers. All three expose an OpenAI-compatible /chat/completions endpoint,
 * so one client implementation (llm.ts) covers all of them.
 */
export function loadLlmProviders(): LlmProviderConfig[] {
  const env = loadEnv(ProviderEnvSchema);
  const providers: LlmProviderConfig[] = [];

  if (env.GEMINI_API_KEY) {
    providers.push({
      label: 'gemini',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    });
  }
  if (env.GROQ_API_KEY) {
    providers.push({
      label: 'groq',
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
      model: env.GROQ_MODEL,
    });
  }
  if (env.OPENROUTER_API_KEY) {
    providers.push({
      label: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
    });
  }

  if (providers.length === 0) {
    throw new Error(
      'No LLM provider configured — set at least one of GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY',
    );
  }

  return providers;
}
