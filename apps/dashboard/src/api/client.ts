import type {
  ChatMessage,
  ContentDnaRecord,
  ContentItem,
  ContentStatus,
  LearningEvent,
  PublishEvent,
  Revision,
  VisualAsset,
  VisualReferenceAsset,
  VisualReferenceKind,
} from '@bb/shared-types';

import { clearStoredToken, getStoredToken } from './authToken';

// '/api' (Vite's dev-only proxy to localhost:4000, see vite.config.ts) unless a real
// deployed API URL is baked in at build time — Netlify builds set this so the
// static production bundle knows where apps/api actually lives.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

// Set by App.tsx when a 401 comes back — lets the login gate re-prompt without this
// module needing to import React/hold component state itself.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

// Agent selector (spec 17.1) — one tab per head agent. Instagram's three
// specialists (Posts/Carousels/Reels) aren't separate tabs: the head agent routes
// format internally (spec 7.1), same as the REST API.
export const PLATFORMS = ['linkedin', 'x', 'instagram', 'youtube-shorts', 'blog'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  'youtube-shorts': 'YouTube Shorts',
  blog: 'Blog',
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorName: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // A deployed API returns 401 only for a missing/wrong shared-secret token
    // (apps/api/src/auth.ts) — never for local dev, where DASHBOARD_SHARED_SECRET
    // is unset and this branch can't be hit. Clear the stale token and let the
    // login gate re-prompt rather than surfacing this as a generic error bubble.
    if (response.status === 401) {
      clearStoredToken();
      onUnauthorized?.();
    }
    const errorBody = body as { error?: string; message?: string } | null;
    throw new ApiError(
      response.status,
      errorBody?.error ?? 'UnknownError',
      errorBody?.message ?? `Request to ${path} failed with status ${response.status}`,
    );
  }
  return body as T;
}

function post<T>(path: string, payload?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}) });
}

// --- Content lifecycle (packages/workflows, spec 15) ---

export function listContent(filter?: { status?: ContentStatus; platform?: Platform }): Promise<{ items: ContentItem[] }> {
  const params = new URLSearchParams();
  if (filter?.status) params.set('status', filter.status);
  if (filter?.platform) params.set('platform', filter.platform);
  const query = params.toString();
  return request(`/content${query ? `?${query}` : ''}`);
}

export function getContent(id: string): Promise<{ item: ContentItem }> {
  return request(`/content/${id}`);
}

export function approveContent(id: string, version: number, approvedBy: string): Promise<{ item: ContentItem }> {
  return post(`/content/${id}/approve`, { version, approvedBy });
}

export function requestChanges(id: string, feedback: string): Promise<{ item: ContentItem }> {
  return post(`/content/${id}/request-changes`, { feedback });
}

export function rejectContent(id: string, reason: string): Promise<{ item: ContentItem }> {
  return post(`/content/${id}/reject`, { reason });
}

export function publishContent(id: string): Promise<{ item: ContentItem; event: PublishEvent }> {
  return post(`/content/${id}/publish`);
}

export function scheduleContent(id: string, scheduledFor: string): Promise<{ item: ContentItem; event: PublishEvent }> {
  return post(`/content/${id}/schedule`, { scheduledFor });
}

export function modifySchedule(id: string, scheduledFor: string): Promise<{ item: ContentItem; event: PublishEvent }> {
  return post(`/content/${id}/schedule/modify`, { scheduledFor });
}

export function cancelSchedule(id: string): Promise<{ item: ContentItem; event: PublishEvent }> {
  return post(`/content/${id}/schedule/cancel`);
}

export function listRevisions(id: string): Promise<{ revisions: Revision[] }> {
  return request(`/content/${id}/revisions`);
}

// `threadPosts` is X-only (spec 6.1): pass the full ordered array to save/keep a
// thread, an array of length 1 (or omit) to save as a single post, or leave
// undefined entirely for non-X platforms whose package shape this doesn't apply to.
export function saveManualRevision(
  id: string,
  newText: string,
  changedById: string,
  threadPosts?: string[] | null,
): Promise<{ item: ContentItem; revision: Revision }> {
  return post(`/content/${id}/revisions`, {
    newText,
    changedById,
    ...(threadPosts !== undefined ? { threadPosts } : {}),
  });
}

export function listPublishEvents(id: string): Promise<{ events: PublishEvent[] }> {
  return request(`/content/${id}/publish-events`);
}

// --- Content DNA + Learning Loop (spec 16) ---

export function getContentDna(): Promise<{ contentDna: ContentDnaRecord | null }> {
  return request('/content-dna');
}

export function listLearningEvents(): Promise<{ events: LearningEvent[] }> {
  return request('/content-dna/learning-events');
}

export function confirmLearningEvent(id: string, confirmedBy: string): Promise<{ contentDna: ContentDnaRecord }> {
  return post(`/content-dna/learning-events/${id}/confirm`, { confirmedBy });
}

export function rejectLearningEvent(id: string): Promise<{ ok: true }> {
  return post(`/content-dna/learning-events/${id}/reject`);
}

// --- Per-agent chat (spec 17.2) ---

export interface ChatResponse {
  runId: string;
  reply: string;
  action: string;
  result: unknown;
}

// Resolves to the platform's currently active session (auto-creating its very
// first one) — call startNewChatSession to explicitly begin a fresh thread instead.
export function listChatMessages(platform: Platform): Promise<{ sessionId: string; messages: ChatMessage[] }> {
  return request(`/${platform}/chat`);
}

export function startNewChatSession(platform: Platform): Promise<{ sessionId: string; messages: ChatMessage[] }> {
  return post(`/${platform}/chat/new-session`);
}

export function sendChatMessage(
  platform: Platform,
  sessionId: string,
  message: string,
  openContentId: string | null,
): Promise<ChatResponse> {
  return post(`/${platform}/chat`, { message, sessionId, openContentId });
}

// --- BB Visual Agent (packages/agents/visual) ---
// Gated on BB_VISUAL_AGENT_ENABLED server-side (apps/api/src/routes/visual.ts) —
// when the flag is off, these calls 403 with an explicit message rather than
// silently doing nothing.

export function getVisualAsset(contentId: string): Promise<{ asset: VisualAsset | null }> {
  return request(`/visual/${contentId}`);
}

// Manual/browser-driven path only (deliberately not the billed `/generate`
// endpoint — see the visual agent no-paid-api memory): step 1 decides whether a
// visual is warranted and, if so, returns the exact prompt for a human/Claude to
// paste into a free image-gen web UI (ChatGPT, Gemini web, Google Flow).
export interface PrepareVisualResult {
  runId: string;
  terminal: boolean;
  asset?: VisualAsset;
  visualId?: string;
  prompt?: string;
  negativePrompt?: string;
  aspectRatio?: string;
}

export function prepareVisual(contentId: string): Promise<PrepareVisualResult> {
  return post(`/visual/${contentId}/prepare`);
}

// Step 2 — finishes a GENERATION_PENDING brief once the image has been generated
// in a web UI and downloaded. `imageBase64` excludes the `data:...;base64,` prefix.
// --- Visual reference library (packages/db/src/repositories/visualReferenceAssets) ---
// Persistent character/style reference images so the visual agent's generation
// prompt can stay consistent across posts — see the blog thumbnail flow.

export function listReferences(
  platform: string,
  kind?: VisualReferenceKind,
): Promise<{ references: VisualReferenceAsset[] }> {
  const params = new URLSearchParams({ platform });
  if (kind) params.set('kind', kind);
  return request(`/references?${params.toString()}`);
}

export function uploadReference(
  platform: string,
  kind: VisualReferenceKind,
  label: string | null,
  base64Data: string,
  mimeType: string,
): Promise<{ reference: VisualReferenceAsset }> {
  return post('/references', { platform, kind, label, base64Data, mimeType });
}

export function deleteReference(id: string): Promise<{ ok: true }> {
  return request(`/references/${id}`, { method: 'DELETE' });
}

// Your own image, attached as-is: stored APPROVED (no QA, no review step) and
// published with the content on every platform.
export function uploadVisual(
  contentId: string,
  imageBase64: string,
  mimeType: string,
): Promise<{ asset: VisualAsset }> {
  return post(`/visual/${contentId}/upload`, { base64Data: imageBase64, mimeType });
}

// Step 3 — the human decision a NEEDS_REVIEW visual (pixels stored, but visual
// quality can never be auto-verified — see visualAsset.ts) has been waiting on.
// Only an APPROVED visual is eligible to become a blog post's cover image at
// publish time.
export function approveVisual(contentId: string, visualId: string): Promise<{ asset: VisualAsset }> {
  return post(`/visual/${contentId}/approve`, { visualId });
}

export function rejectVisual(
  contentId: string,
  visualId: string,
  reason: string,
): Promise<{ asset: VisualAsset }> {
  return post(`/visual/${contentId}/reject`, { visualId, reason });
}
