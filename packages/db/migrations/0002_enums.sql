-- The 9-state lifecycle from spec section 0.3.
CREATE TYPE content_status AS ENUM (
  'idea', 'researched', 'draft', 'in_review', 'changes_requested',
  'approved', 'scheduled', 'published', 'rejected'
);

CREATE TYPE agent_mode AS ENUM (
  'source_discovery', 'single_topic', 'postcast_interview', 'repurpose',
  'youtube_link', 'voice_note', 'edit'
);

CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');

CREATE TYPE change_type AS ENUM (
  'ai_draft', 'ai_regeneration', 'user_edit', 'interview_answer',
  'angle_selection', 'system_reset'
);

CREATE TYPE changed_by_type AS ENUM ('user', 'agent', 'system');

CREATE TYPE source_tier AS ENUM ('tier_1_primary', 'tier_2_secondary', 'tier_3_community');

CREATE TYPE source_status AS ENUM ('active', 'inaccessible', 'removed', 'flagged');

CREATE TYPE learning_source AS ENUM ('user_instruction', 'user_edit', 'approval', 'rejection', 'performance');

-- Table from spec section 16.2.
CREATE TYPE learning_strength AS ENUM (
  'very_strong', 'strong', 'weak', 'weak_until_explained', 'not_a_voice_signal', 'never'
);

CREATE TYPE dna_status AS ENUM ('draft', 'active', 'superseded');

CREATE TYPE qa_overall_status AS ENUM ('PASS', 'PASS_WITH_WARNINGS', 'BLOCKED');
