import type { ChatMessage, NewChatMessageInput } from '@bb/shared-types';
import { ChatMessageSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface ChatMessageRow {
  id: string;
  platform: string;
  role: string;
  content: string;
  action: unknown;
  created_at: Date;
}

function mapRow(row: ChatMessageRow): ChatMessage {
  return ChatMessageSchema.parse({
    id: row.id,
    platform: row.platform,
    role: row.role,
    content: row.content,
    action: row.action,
    createdAt: row.created_at.toISOString(),
  });
}

export async function insertChatMessage(db: Queryable, input: NewChatMessageInput): Promise<ChatMessage> {
  const result = await db.query<ChatMessageRow>(
    `INSERT INTO chat_messages (platform, role, content, action)
     VALUES ($1, $2::chat_role, $3, $4::jsonb)
     RETURNING *`,
    [input.platform, input.role, input.content, input.action ? JSON.stringify(input.action) : null],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertChatMessage: insert returned no row');
  return mapRow(row);
}

export async function listChatMessages(db: Queryable, platform: string, limit = 100): Promise<ChatMessage[]> {
  const result = await db.query<ChatMessageRow>(
    'SELECT * FROM chat_messages WHERE platform = $1 ORDER BY created_at ASC LIMIT $2',
    [platform, limit],
  );
  return result.rows.map(mapRow);
}
