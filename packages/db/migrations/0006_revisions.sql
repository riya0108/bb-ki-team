-- Maps the REVISION record, spec section 23.3.
CREATE TABLE revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  version int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  change_type change_type NOT NULL,
  previous_text text,
  new_text text NOT NULL,
  changed_by changed_by_type NOT NULL,
  changed_by_id text,
  reason text,
  approval_invalidated boolean NOT NULL DEFAULT false,
  UNIQUE (content_id, version)
);
