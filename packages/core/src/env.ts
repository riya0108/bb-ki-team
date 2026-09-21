import { z } from 'zod';

const RawEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  // Loopback-only by default: this API has no authentication unless
  // DASHBOARD_SHARED_SECRET is set (see auth.ts) — spec 17's dashboard was designed
  // as a trusted local operator tool, not a deployed service, so it must not be
  // reachable from the network by default. Only widen this deliberately (2026-09-16:
  // deploying apps/api so the dashboard works from a phone) alongside setting that
  // secret — never widen API_HOST without it.
  API_HOST: z.string().min(1).default('127.0.0.1'),
  // Single-operator shared-secret gate (apps/api/src/auth.ts) — required once
  // API_HOST is widened beyond loopback. Unset locally; a real deployment (Render,
  // etc.) must set this to a long random value.
  DASHBOARD_SHARED_SECRET: z.string().optional(),
  // Browser-enforced allowlist for cross-origin dashboard requests (apps/api/src/app.ts).
  // Unset locally — the Vite dev proxy makes requests same-origin so CORS never
  // applies. Once apps/api is deployed separately from the dashboard (2026-09-16:
  // Render + Netlify), the two live on different origins and the browser blocks
  // every fetch without this set to the dashboard's exact origin.
  CORS_ALLOWED_ORIGIN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  // No API key: Ollama is a local install (brew services start ollama) with no
  // account, no auth, no billing surface — setting this alone enables it.
  OLLAMA_MODEL: z.string().optional(),
  X_API_KEY: z.string().optional(),
  X_API_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),
  BUFFER_ACCESS_TOKEN: z.string().optional(),
  BUFFER_CHANNEL_ID: z.string().optional(),
  BLOG_REPO_PATH: z.string().optional(),
  BLOG_REPO_BRANCH: z.string().optional(),
  BLOG_SITE_BASE_URL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  NOTIFY_EMAIL_TO: z.string().optional(),
  NOTIFY_EMAIL_FROM: z.string().optional(),
});

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
}

// OAuth 1.0a user-context credentials for the X (Twitter) publish connector
// (packages/mcp-servers/x) — spec's Connector Layer. Undefined until all four are
// set, same as an LLM provider being "not configured" (providerConfig below).
export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

// Buffer Publish API credentials (packages/mcp-servers/buffer) — spec's Connector
// Layer. This is the actual free X publish/schedule path: X's own direct API
// (XCredentials above) demands paid credits per post on this account (see
// apps/api/src/deps.ts), so Buffer — which schedules/publishes to X on this
// account's behalf without touching X's paid API — is what apps/api and
// apps/worker register as platform "x"'s real connector. channelId identifies
// which connected Buffer channel (i.e. which X account) to post to.
export interface BufferCredentials {
  accessToken: string;
  channelId: string;
}

// Git-push publish connector (packages/mcp-servers/blog-git) — spec's Connector
// Layer for platform "blog". There is no blog platform API: the live site
// (bullorbear.in) is a static Astro site whose GitHub Actions workflow deploys on
// every push to `branch`, so "publishing" a blog post means committing an MDX file
// into repoPath and pushing. repoPath must be an existing local clone with a
// working `origin` remote the current machine can already push to (same
// credentials a human would use to push manually). siteBaseUrl is only used to
// build the PUBLISH_EVENT's platformUrl, not for anything functional.
export interface BlogGitConfig {
  repoPath: string;
  branch: string;
  siteBaseUrl: string;
}

// Resend (https://resend.com) email config (packages/core/src/notify.ts) — tells a
// human "your scheduled post just published, here's the link" once a PUBLISH_EVENT
// records success. RESEND_API_KEY + NOTIFY_EMAIL_TO together enable it
// (NOTIFY_EMAIL_FROM defaults to Resend's no-verification-needed sandbox sender);
// unset leaves this undefined and no email is ever sent, same "unset = honestly
// not configured" pattern as every other connector here.
export interface EmailConfig {
  apiKey: string;
  to: string;
  from: string;
}

export interface Env {
  databaseUrl: string;
  apiPort: number;
  apiHost: string;
  dashboardSharedSecret?: string | undefined;
  corsAllowedOrigin?: string | undefined;
  gemini?: LlmProviderConfig | undefined;
  groq?: LlmProviderConfig | undefined;
  openrouter?: LlmProviderConfig | undefined;
  ollama?: LlmProviderConfig | undefined;
  x?: XCredentials | undefined;
  buffer?: BufferCredentials | undefined;
  blogGit?: BlogGitConfig | undefined;
  email?: EmailConfig | undefined;
}

export class EnvValidationError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

function providerConfig(
  apiKey: string | undefined,
  model: string | undefined,
): LlmProviderConfig | undefined {
  if (!apiKey) return undefined;
  if (!model) return undefined;
  return { apiKey, model };
}

function xCredentialsConfig(raw: z.infer<typeof RawEnvSchema>): XCredentials | undefined {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = raw;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) return undefined;
  return {
    apiKey: X_API_KEY,
    apiSecret: X_API_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessTokenSecret: X_ACCESS_TOKEN_SECRET,
  };
}

function bufferCredentialsConfig(raw: z.infer<typeof RawEnvSchema>): BufferCredentials | undefined {
  const { BUFFER_ACCESS_TOKEN, BUFFER_CHANNEL_ID } = raw;
  if (!BUFFER_ACCESS_TOKEN || !BUFFER_CHANNEL_ID) return undefined;
  return { accessToken: BUFFER_ACCESS_TOKEN, channelId: BUFFER_CHANNEL_ID };
}

function blogGitConfig(raw: z.infer<typeof RawEnvSchema>): BlogGitConfig | undefined {
  if (!raw.BLOG_REPO_PATH) return undefined;
  return {
    repoPath: raw.BLOG_REPO_PATH,
    branch: raw.BLOG_REPO_BRANCH ?? 'master',
    siteBaseUrl: raw.BLOG_SITE_BASE_URL ?? 'https://bullorbear.in',
  };
}

function emailConfig(raw: z.infer<typeof RawEnvSchema>): EmailConfig | undefined {
  if (!raw.RESEND_API_KEY || !raw.NOTIFY_EMAIL_TO) return undefined;
  return {
    apiKey: raw.RESEND_API_KEY,
    to: raw.NOTIFY_EMAIL_TO,
    from: raw.NOTIFY_EMAIL_FROM || 'Bull or Bear <onboarding@resend.dev>',
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = RawEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  const raw = parsed.data;
  const gemini = providerConfig(raw.GEMINI_API_KEY, raw.GEMINI_MODEL);
  const groq = providerConfig(raw.GROQ_API_KEY, raw.GROQ_MODEL);
  const openrouter = providerConfig(raw.OPENROUTER_API_KEY, raw.OPENROUTER_MODEL);
  // No real API key to check — Ollama has no auth, so OLLAMA_MODEL alone enables it.
  // The placeholder string is never validated by Ollama; it only exists because
  // callOpenAiCompatible always sends an Authorization header.
  const ollama = raw.OLLAMA_MODEL ? { apiKey: 'ollama-local', model: raw.OLLAMA_MODEL } : undefined;

  if (!gemini && !groq && !openrouter && !ollama) {
    throw new EnvValidationError([
      'at least one LLM provider must be configured (GEMINI_API_KEY+GEMINI_MODEL, GROQ_API_KEY+GROQ_MODEL, OPENROUTER_API_KEY+OPENROUTER_MODEL, or OLLAMA_MODEL with `brew services start ollama` running locally)',
    ]);
  }

  return {
    databaseUrl: raw.DATABASE_URL,
    apiPort: raw.API_PORT,
    apiHost: raw.API_HOST,
    dashboardSharedSecret: raw.DASHBOARD_SHARED_SECRET,
    corsAllowedOrigin: raw.CORS_ALLOWED_ORIGIN,
    gemini,
    groq,
    openrouter,
    ollama,
    x: xCredentialsConfig(raw),
    buffer: bufferCredentialsConfig(raw),
    blogGit: blogGitConfig(raw),
    email: emailConfig(raw),
  };
}
