-- Persistent reference images for the BB Visual Agent's generation step (character
-- consistency + thumbnail style matching), decoupled from any single content
-- item/version — unlike visual_assets (one row per content_id/version), these are
-- deliberately reused across many future generations until replaced/deactivated.
-- Scoped by platform because the first use case is blog thumbnails specifically;
-- not every platform needs a recurring character.
CREATE TYPE visual_reference_kind AS ENUM ('character', 'thumbnail_style');

CREATE TABLE visual_reference_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  kind visual_reference_kind NOT NULL,
  label text,
  asset_path text NOT NULL,
  mime_type text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX visual_reference_assets_platform_kind_idx
  ON visual_reference_assets (platform, kind);

ALTER TABLE visual_reference_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON visual_reference_assets FROM anon, authenticated;

-- visual_assets (0018) was created after 0017's RLS sweep and was missed since it
-- didn't exist yet — closing that gap here since this migration touches the same
-- subsystem.
ALTER TABLE visual_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON visual_assets FROM anon, authenticated;
