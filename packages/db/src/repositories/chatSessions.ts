import type { ChatSession } from '@bb/shared-types';
import { ChatSessionSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface ChatSessionRow {
  id: string;
  platform: string;
  created_at: Date;
}

function mapRow(row: ChatSessionRow): ChatSession {
  return ChatSessionSchema.parse({ id: row.id, platform: row.platform, createdAt: row.created_at.toISOString() });
}

export async function createChatSession(db: Queryable, platform: string): Promise<ChatSession> {
  const result = await db.query<ChatSessionRow>(
    'INSERT INTO chat_sessions (platform) VALUES ($1) RETURNING *',
    [platform],
  );
  const row = result.rows[0];
  if (!row) throw new Error('createChatSession: insert returned no row');
  return mapRow(row);
}

// The thread a platform's chat pane opens to by default — whichever session was
// created most recently, auto-creating one the very first time a platform is used
// (mirrors the old always-append behavior for a brand-new platform, but scoped).
export async function getOrCreateLatestChatSession(db: Queryable, platform: string): Promise<ChatSession> {
  const result = await db.query<ChatSessionRow>(
    'SELECT * FROM chat_sessions WHERE platform = $1 ORDER BY created_at DESC LIMIT 1',
    [platform],
  );
  const row = result.rows[0];
  if (row) return mapRow(row);
  return createChatSession(db, platform);
}
