import type {
  ChatMessage,
  ContentDnaRecord,
  ContentItem,
  ContentStatus,
  LearningEvent,
  PublishEvent,
  Revision,
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
