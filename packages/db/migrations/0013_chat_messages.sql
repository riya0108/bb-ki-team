CREATE TYPE chat_role AS ENUM ('user', 'assistant');

-- Per-platform chat log for the dashboard's chat pane (spec 17.1). Not scoped to a
-- session/user id: this is a single-operator internal tool, and the "conversation"
-- is simply the running log for whichever head agent is selected. `action` records
-- what the assistant turn actually did (classified intent + params + result summary)
-- so the activity log can show real actions taken, not just chat bubbles.
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  role chat_role NOT NULL,
  content text NOT NULL,
  action jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_platform_created_at_idx ON chat_messages (platform, created_at);
