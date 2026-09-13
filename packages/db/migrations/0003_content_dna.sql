-- Maps the CONTENT_DNA record, spec section 3.3.
CREATE TABLE content_dna (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL UNIQUE,
  status dna_status NOT NULL DEFAULT 'draft',
  identity jsonb NOT NULL,
  topics jsonb NOT NULL,
  opinions jsonb NOT NULL,
  voice jsonb NOT NULL,
  storytelling jsonb NOT NULL,
  personal_context jsonb NOT NULL,
  platform_preferences jsonb NOT NULL,
  learning jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  confirmed_by text
);

-- At most one active version at a time (spec 3.4: never silently rewrite DNA).
CREATE UNIQUE INDEX content_dna_single_active ON content_dna (status) WHERE status = 'active';
