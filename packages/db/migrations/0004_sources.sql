-- Maps the SOURCE record, spec section 23.2.
CREATE TABLE sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  platform text NOT NULL,
  url text NOT NULL UNIQUE,
  author text,
  published_at timestamptz,
  accessed_at timestamptz,
  tier source_tier NOT NULL DEFAULT 'tier_2_secondary',
  topics text[] NOT NULL DEFAULT '{}',
  claims jsonb NOT NULL DEFAULT '[]',
  evidence_links text[] NOT NULL DEFAULT '{}',
  relevance_score numeric(4, 3),
  risk_score numeric(4, 3),
  status source_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
