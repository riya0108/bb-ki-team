-- Supports the LinkedIn PostCast interview mode, spec section 5.3.
CREATE TABLE interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text,
  status text NOT NULL DEFAULT 'active',
  turns jsonb NOT NULL DEFAULT '[]',
  content_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
