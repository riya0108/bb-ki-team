-- Maps the LEARNING_EVENT record, spec section 23.4.
CREATE TABLE learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  content_id uuid REFERENCES content_items (id) ON DELETE SET NULL,
  source learning_source NOT NULL,
  observation text NOT NULL,
  strength learning_strength NOT NULL,
  confidence numeric(4, 3),
  proposed_change jsonb,
  confirmed_by_user boolean,
  applied_to_dna boolean NOT NULL DEFAULT false,
  dna_version int REFERENCES content_dna (version)
);
