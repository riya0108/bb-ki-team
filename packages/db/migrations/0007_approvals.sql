-- Approval audit trail. Not explicitly named in the spec's data schemas, but required
-- by CLAUDE.md's "every important decision must be auditable" — keeps full approval
-- history off content_items, which only tracks the current approval pointer.
CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  version int NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidated_by_revision_id uuid REFERENCES revisions (id)
);

CREATE INDEX approvals_content_id_idx ON approvals (content_id);
