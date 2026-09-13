CREATE TYPE publish_result AS ENUM ('success', 'failed');

-- Maps the PUBLISH_EVENT record, spec section 15.3. Append-only audit trail: every
-- publish/schedule ATTEMPT is recorded, success or failure, never just successes —
-- spec 15.4: "never claim a post was published unless the connector confirms it."
CREATE TABLE publish_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  platform text NOT NULL,
  version int NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL,
  scheduled_for timestamptz,
  published_at timestamptz,
  platform_post_id text,
  platform_url text,
  connector text NOT NULL,
  result publish_result NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX publish_events_content_id_idx ON publish_events (content_id);
