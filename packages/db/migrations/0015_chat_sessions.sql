-- Splits the previously single, ever-growing per-platform chat log (migration 0013)
-- into distinct sessions. Needed for two things the operator dashboard didn't
-- support before: an explicit "New chat" action (start a fresh thread instead of
-- endlessly appending to the one conversation a platform has ever had), and a chat
-- pane that doesn't replay the platform's entire history every time it's reopened.
CREATE TABLE chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_sessions_platform_created_at_idx ON chat_sessions (platform, created_at DESC);

ALTER TABLE chat_messages ADD COLUMN session_id uuid REFERENCES chat_sessions(id) ON DELETE CASCADE;

-- Backfill: give every platform's pre-existing messages one legacy session (keyed to
-- that platform's earliest message) so nothing already in the ledger is orphaned.
WITH legacy_sessions AS (
  INSERT INTO chat_sessions (platform, created_at)
  SELECT platform, min(created_at) FROM chat_messages GROUP BY platform
  RETURNING id, platform
)
UPDATE chat_messages cm
SET session_id = legacy_sessions.id
FROM legacy_sessions
WHERE cm.platform = legacy_sessions.platform;

ALTER TABLE chat_messages ALTER COLUMN session_id SET NOT NULL;

CREATE INDEX chat_messages_session_id_created_at_idx ON chat_messages (session_id, created_at);
