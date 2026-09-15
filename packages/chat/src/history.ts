import { insertChatMessage, listChatMessages } from '@bb/db';
import type { Queryable } from '@bb/db';
import type { ChatActionRecord, ChatMessage } from '@bb/shared-types';

const HISTORY_LIMIT = 20;

export async function loadRecentChatHistory(db: Queryable, sessionId: string): Promise<ChatMessage[]> {
  return listChatMessages(db, sessionId, HISTORY_LIMIT);
}

export async function recordUserChatMessage(
  db: Queryable,
  sessionId: string,
  platform: string,
  content: string,
): Promise<ChatMessage> {
  return insertChatMessage(db, { sessionId, platform, role: 'user', content });
}

export async function recordAssistantChatMessage(
  db: Queryable,
  sessionId: string,
  platform: string,
  content: string,
  action: ChatActionRecord | null,
): Promise<ChatMessage> {
  return insertChatMessage(db, { sessionId, platform, role: 'assistant', content, action });
}
