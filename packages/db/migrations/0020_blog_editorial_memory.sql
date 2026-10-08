-- Blog Editorial Memory + Blog Style Profile (Agent 05 editorial upgrade).
--
-- editorial_memories: consolidated, deduplicated editorial patterns that make a
-- successful Bull or Bear article ("question-led openings for economic explainers",
-- "quizzes felt forced"). Distinct from content_dna (the creator's voice, versioned)
-- and learning_events (the raw signal log). One row per (scope, subject, polarity) —
-- repeated signals reinforce the same row instead of appending duplicates; a newer
-- opposite-polarity memory supersedes the older one rather than deleting it, so the
-- history stays auditable.
CREATE TYPE editorial_memory_status AS ENUM ('CONFIRMED', 'INFERRED', 'REJECTED', 'TEMPORARY', 'EXPERIMENTAL');
CREATE TYPE editorial_memory_category AS ENUM ('structure', 'language', 'editorial', 'quality');

CREATE TABLE editorial_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'blog',
  category editorial_memory_category NOT NULL,
  subject text NOT NULL,
  polarity text NOT NULL CHECK (polarity IN ('prefer', 'avoid')),
  statement text NOT NULL,
  confidence numeric(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source text NOT NULL,
  status editorial_memory_status NOT NULL,
  times_confirmed int NOT NULL DEFAULT 0,
  times_rejected int NOT NULL DEFAULT 0,
  valid_until timestamptz,
  superseded_by uuid REFERENCES editorial_memories (id) ON DELETE SET NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- At most one live (non-superseded) memory per subject+polarity per scope.
CREATE UNIQUE INDEX editorial_memories_live_subject_idx
  ON editorial_memories (scope, subject, polarity)
  WHERE superseded_by IS NULL;

-- blog_style_samples: abstracted style metrics/traits per article. Never stores the
-- article's text (spec: "do not store large verbatim passages") — only measurements
-- and short trait labels. The active Blog Style Profile is aggregated from these.
CREATE TABLE blog_style_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('approved_article', 'own_published', 'approved_reference', 'user_supplied')),
  label text NOT NULL,
  source_url text,
  content_id uuid REFERENCES content_items (id) ON DELETE SET NULL,
  metrics jsonb NOT NULL,
  traits jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One approved-article sample per content item (re-approval replaces it).
CREATE UNIQUE INDEX blog_style_samples_content_idx
  ON blog_style_samples (content_id)
  WHERE content_id IS NOT NULL;

ALTER TABLE editorial_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_style_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON editorial_memories FROM anon, authenticated;
REVOKE ALL ON blog_style_samples FROM anon, authenticated;
