-- Maps the QA output contract, spec section 14.3.
CREATE TABLE qa_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_items (id) ON DELETE CASCADE,
  version int NOT NULL,
  overall_status qa_overall_status NOT NULL,
  result jsonb NOT NULL,
  publish_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, version)
);
