import { z } from 'zod';

// Mirrors the chat_messages table (packages/db/migrations/0013_chat_messages.sql),
// backing the dashboard's per-agent chat pane (spec 17.1).
export const ChatRoleSchema = z.enum(['user', 'assistant']);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

// What an assistant turn actually did — recorded alongside the reply so the
// dashboard's activity log can show real actions, not just chat bubbles. `action`
// is null for a user turn, or for an assistant turn the classifier couldn't map to
// any supported action.
export const ChatActionRecordSchema = z.object({
  name: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type ChatActionRecord = z.infer<typeof ChatActionRecordSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  platform: z.string(),
  role: ChatRoleSchema,
  content: z.string(),
  action: ChatActionRecordSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const NewChatMessageInputSchema = z.object({
  sessionId: z.string().uuid(),
  platform: z.string(),
  role: ChatRoleSchema,
  content: z.string(),
  action: ChatActionRecordSchema.nullable().optional(),
});
export type NewChatMessageInput = z.infer<typeof NewChatMessageInputSchema>;

// A distinct conversation thread for a platform (migration 0015) — "New chat" starts
// one of these; the dashboard's chat pane always shows exactly one session's worth
// of messages, not a platform's entire history.
export const ChatSessionSchema = z.object({
  id: z.string().uuid(),
  platform: z.string(),
  createdAt: z.string().datetime(),
});
export type ChatSession = z.infer<typeof ChatSessionSchema>;
