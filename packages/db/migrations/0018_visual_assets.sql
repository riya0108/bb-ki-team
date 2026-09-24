-- BB Visual Agent (additive, backward-compatible visual-production layer). One row
-- per (content_id, version) so a text edit that bumps content_items.current_version
-- gets its own visual row instead of overwriting a prior approved visual's history.
-- Gated end-to-end by BB_VISUAL_AGENT_ENABLED=false — this table simply has no rows
-- until the flag is turned on and the on-demand visual endpoint is called.

CREATE TYPE visual_status AS ENUM (
  'NOT_REQUIRED', 'BRIEF_READY', 'GENERATION_PENDING', 'GENERATED',
  'QA_PASS', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'
);

CREATE TYPE visual_decision AS ENUM (
  'REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'NOT_APPROPRIATE', 'REAL_ASSET_REQUIRED'
);

CREATE TABLE visual_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  version int NOT NULL,
  status visual_status NOT NULL,
  visual_decision visual_decision,
  asset jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, version)
);

CREATE INDEX visual_assets_content_id_idx ON visual_assets (content_id);
