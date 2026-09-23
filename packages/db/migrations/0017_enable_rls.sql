-- Supabase flagged every public table as publicly readable/writable via the
-- PostgREST API (rls_disabled_in_public / sensitive_columns_exposed): RLS was
-- never enabled, and the default anon/authenticated grants Supabase creates on
-- new tables were still in place. Nothing in this app talks to Postgres through
-- anon/authenticated PostgREST roles — the API/worker connect with the
-- postgres role directly (DATABASE_URL) and the fire-due-schedules edge
-- function uses SUPABASE_SERVICE_ROLE_KEY — both of which bypass RLS, so this
-- locks the tables down with no policies (default deny for PostgREST clients)
-- without touching how the app itself talks to the database.
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_dna ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
