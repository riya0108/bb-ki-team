import type {
  ChatMessage,
  ContentDnaRecord,
  ContentItem,
  ContentStatus,
  LearningEvent,
  PublishEvent,
  Revision,
} from '@bb/shared-types';

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
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
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

export function listRevisions(id: string): Promise<{ revisions: Revision[] }> {
  return request(`/content/${id}/revisions`);
}

export function saveManualRevision(id: string, newText: string, changedById: string): Promise<{ item: ContentItem; revision: Revision }> {
  return post(`/content/${id}/revisions`, { newText, changedById });
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
