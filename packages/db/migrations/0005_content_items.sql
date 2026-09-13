-- Maps the CONTENT_ITEM record, spec section 23.1, plus Phase-1 ledger fields.
CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'linkedin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_agent text NOT NULL,
  mode agent_mode NOT NULL,
  topic text,
  content_pillar text,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  source_urls text[] NOT NULL DEFAULT '{}',
  core_claim text,
  angle text,
  content_dna_version int NOT NULL REFERENCES content_dna (version),
  current_version int NOT NULL DEFAULT 1,
  current_text text NOT NULL,
  status content_status NOT NULL DEFAULT 'draft',
  risk_level risk_level NOT NULL DEFAULT 'low',
  approved_version int,
  approved_at timestamptz,
  approved_by text,
  package jsonb,
  -- Defense-in-depth invariant for spec 15.2 ("editing an approved item invalidates
  -- approval"); the actual transition is application logic in packages/workflows so
  -- it stays unit-testable, this CHECK is the backstop.
  CONSTRAINT approved_matches_current CHECK (status <> 'approved' OR approved_version = current_version)
);

CREATE INDEX content_items_status_idx ON content_items (status);
