-- pg_cron + pg_net replacement for apps/worker's local poll loop, scoped to the
-- "fire due blog schedules" Edge Function (supabase/functions/fire-due-schedules).
-- Runs every minute regardless of whether any machine is online, which is the whole
-- point: a scheduled blog post now fires even with every laptop closed.
--
-- The shared secret this job sends as the x-cron-secret header is intentionally NOT
-- inlined here (this file is committed to git) — Supabase's hosted "postgres" role
-- isn't a true superuser, so it can't set custom GUCs via ALTER DATABASE (the usual
-- trick for this), so instead it's a row in cron_config below, inserted once, out of
-- band, directly against the Supabase project — the same way .env keeps real secrets
-- out of the repo. See the deploy notes in supabase/functions/fire-due-schedules.
--
-- cron_config isn't exposed through the app's own API (apps/api never queries it) and
-- holds nothing beyond this job's own config, so it carries the same trust boundary
-- as the rest of this database rather than needing its own access control.
CREATE TABLE IF NOT EXISTS cron_config (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- Re-runnable: unschedule-then-schedule so applying this migration twice (or editing
-- the URL/cadence later and re-running by hand) doesn't create duplicate jobs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fire-due-blog-schedules') THEN
    PERFORM cron.unschedule('fire-due-blog-schedules');
  END IF;
END $$;

SELECT cron.schedule(
  'fire-due-blog-schedules',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM cron_config WHERE key = 'fire_due_schedules_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM cron_config WHERE key = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
