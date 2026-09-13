import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from './env.js';

const baseValidEnv = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/bullorbear',
  GEMINI_API_KEY: 'key',
  GEMINI_MODEL: 'gemini-flash-latest',
};

describe('loadEnv', () => {
  it('loads a valid env with one LLM provider configured', () => {
    const env = loadEnv(baseValidEnv);
    expect(env.databaseUrl).toBe(baseValidEnv.DATABASE_URL);
    expect(env.apiPort).toBe(4000);
    expect(env.gemini).toEqual({ apiKey: 'key', model: 'gemini-flash-latest' });
    expect(env.groq).toBeUndefined();
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _unused, ...rest } = baseValidEnv;
    expect(() => loadEnv(rest)).toThrow(EnvValidationError);
  });

  it('throws when no LLM provider is configured', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: baseValidEnv.DATABASE_URL,
      }),
    ).toThrow(/at least one LLM provider/);
  });

  it('ignores a provider whose model is missing even if the key is set', () => {
    const env = loadEnv({
      DATABASE_URL: baseValidEnv.DATABASE_URL,
      GROQ_API_KEY: 'key-only',
      OPENROUTER_API_KEY: 'key',
      OPENROUTER_MODEL: 'some-model',
    });
    expect(env.groq).toBeUndefined();
    expect(env.openrouter).toEqual({ apiKey: 'key', model: 'some-model' });
  });

  it('coerces API_PORT from a string', () => {
    const env = loadEnv({ ...baseValidEnv, API_PORT: '5000' });
    expect(env.apiPort).toBe(5000);
  });
});
