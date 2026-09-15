import type { ChatMessage, NewChatMessageInput } from '@bb/shared-types';
import { ChatMessageSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface ChatMessageRow {
  id: string;
  session_id: string;
  platform: string;
  role: string;
  content: string;
  action: unknown;
  created_at: Date;
}

function mapRow(row: ChatMessageRow): ChatMessage {
  return ChatMessageSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    platform: row.platform,
    role: row.role,
    content: row.content,
    action: row.action,
    createdAt: row.created_at.toISOString(),
  });
}

export async function insertChatMessage(db: Queryable, input: NewChatMessageInput): Promise<ChatMessage> {
  const result = await db.query<ChatMessageRow>(
    `INSERT INTO chat_messages (session_id, platform, role, content, action)
     VALUES ($1, $2, $3::chat_role, $4, $5::jsonb)
     RETURNING *`,
    [input.sessionId, input.platform, input.role, input.content, input.action ? JSON.stringify(input.action) : null],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertChatMessage: insert returned no row');
  return mapRow(row);
}

// Scoped to one session — a platform's chat pane shows one conversation thread at a
// time (migration 0015), not everything ever said about that platform.
export async function listChatMessages(db: Queryable, sessionId: string, limit = 200): Promise<ChatMessage[]> {
  const result = await db.query<ChatMessageRow>(
    'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
    [sessionId, limit],
  );
  return result.rows.map(mapRow);
}
