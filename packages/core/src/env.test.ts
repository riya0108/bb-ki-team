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

  it('configures Mistral and NVIDIA NIM fallbacks only when both key and model are set', () => {
    const env = loadEnv({
      DATABASE_URL: baseValidEnv.DATABASE_URL,
      MISTRAL_API_KEY: 'm-key',
      MISTRAL_MODEL: 'mistral-small-latest',
      NVIDIA_API_KEY: 'n-key',
    });
    expect(env.mistral).toEqual({ apiKey: 'm-key', model: 'mistral-small-latest' });
    expect(env.nvidia).toBeUndefined();
  });

  it('coerces API_PORT from a string', () => {
    const env = loadEnv({ ...baseValidEnv, API_PORT: '5000' });
    expect(env.apiPort).toBe(5000);
  });

  it('defaults API_HOST to loopback-only', () => {
    const env = loadEnv(baseValidEnv);
    expect(env.apiHost).toBe('127.0.0.1');
  });

  it('honors an explicit API_HOST override', () => {
    const env = loadEnv({ ...baseValidEnv, API_HOST: '0.0.0.0' });
    expect(env.apiHost).toBe('0.0.0.0');
  });

  it('leaves x undefined when no X credentials are set', () => {
    const env = loadEnv(baseValidEnv);
    expect(env.x).toBeUndefined();
  });

  it('ignores a partial set of X credentials', () => {
    const env = loadEnv({ ...baseValidEnv, X_API_KEY: 'key', X_API_SECRET: 'secret' });
    expect(env.x).toBeUndefined();
  });

  it('loads x credentials when all four are set', () => {
    const env = loadEnv({
      ...baseValidEnv,
      X_API_KEY: 'key',
      X_API_SECRET: 'secret',
      X_ACCESS_TOKEN: 'token',
      X_ACCESS_TOKEN_SECRET: 'token-secret',
    });
    expect(env.x).toEqual({
      apiKey: 'key',
      apiSecret: 'secret',
      accessToken: 'token',
      accessTokenSecret: 'token-secret',
    });
  });

  it('leaves buffer undefined when no Buffer credentials are set', () => {
    const env = loadEnv(baseValidEnv);
    expect(env.buffer).toBeUndefined();
  });

  it('ignores a partial set of Buffer credentials', () => {
    const env = loadEnv({ ...baseValidEnv, BUFFER_ACCESS_TOKEN: 'token' });
    expect(env.buffer).toBeUndefined();
  });

  it('loads buffer credentials when both are set', () => {
    const env = loadEnv({
      ...baseValidEnv,
      BUFFER_ACCESS_TOKEN: 'token',
      BUFFER_CHANNEL_ID: 'channel-1',
    });
    expect(env.buffer).toEqual({ accessToken: 'token', channelId: 'channel-1' });
  });

  it('leaves blogGit undefined when BLOG_REPO_PATH is unset', () => {
    const env = loadEnv(baseValidEnv);
    expect(env.blogGit).toBeUndefined();
  });

  it('loads blogGit with defaults when only BLOG_REPO_PATH is set', () => {
    const env = loadEnv({ ...baseValidEnv, BLOG_REPO_PATH: '/tmp/blog-repo' });
    expect(env.blogGit).toEqual({
      repoPath: '/tmp/blog-repo',
      branch: 'master',
      siteBaseUrl: 'https://bullorbear.in',
    });
  });

  it('loads blogGit with overridden branch and site base url', () => {
    const env = loadEnv({
      ...baseValidEnv,
      BLOG_REPO_PATH: '/tmp/blog-repo',
      BLOG_REPO_BRANCH: 'main',
      BLOG_SITE_BASE_URL: 'https://staging.bullorbear.in',
    });
    expect(env.blogGit).toEqual({
      repoPath: '/tmp/blog-repo',
      branch: 'main',
      siteBaseUrl: 'https://staging.bullorbear.in',
    });
  });

  it('defaults visualAgentEnabled to false and leaves image/storage config undefined', () => {
    const env = loadEnv(baseValidEnv);
    expect(env.visualAgentEnabled).toBe(false);
    expect(env.geminiImage).toBeUndefined();
    expect(env.supabaseStorage).toBeUndefined();
  });

  it('treats any BB_VISUAL_AGENT_ENABLED value other than the literal string "true" as false', () => {
    expect(loadEnv({ ...baseValidEnv, BB_VISUAL_AGENT_ENABLED: 'false' }).visualAgentEnabled).toBe(
      false,
    );
    expect(loadEnv({ ...baseValidEnv, BB_VISUAL_AGENT_ENABLED: 'yes' }).visualAgentEnabled).toBe(
      false,
    );
    expect(loadEnv({ ...baseValidEnv, BB_VISUAL_AGENT_ENABLED: 'true' }).visualAgentEnabled).toBe(
      true,
    );
  });

  it('ignores GEMINI_IMAGE_MODEL without a GEMINI_API_KEY', () => {
    const { GEMINI_API_KEY: _unused, ...rest } = baseValidEnv;
    const env = loadEnv({
      ...rest,
      GROQ_API_KEY: 'k',
      GROQ_MODEL: 'm',
      GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image',
    });
    expect(env.geminiImage).toBeUndefined();
  });

  it('loads geminiImage when GEMINI_API_KEY and GEMINI_IMAGE_MODEL are both set', () => {
    const env = loadEnv({ ...baseValidEnv, GEMINI_IMAGE_MODEL: 'gemini-2.5-flash-image' });
    expect(env.geminiImage).toEqual({ apiKey: 'key', model: 'gemini-2.5-flash-image' });
  });

  it('ignores a partial Supabase Storage config', () => {
    const env = loadEnv({ ...baseValidEnv, SUPABASE_URL: 'https://x.supabase.co' });
    expect(env.supabaseStorage).toBeUndefined();
  });

  it('loads supabaseStorage with a default bucket name', () => {
    const env = loadEnv({
      ...baseValidEnv,
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });
    expect(env.supabaseStorage).toEqual({
      url: 'https://x.supabase.co',
      serviceRoleKey: 'service-role-key',
      bucket: 'visual-assets',
    });
  });
});
