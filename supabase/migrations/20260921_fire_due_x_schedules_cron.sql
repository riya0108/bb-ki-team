-- Same rationale as 20260915_fire_due_schedules_cron.sql (applied by hand against the
-- hosted project, not part of `npm run db:migrate`), but for platform "x" instead of
-- "blog": Render's free plan only allows web services, not a persistent background
-- worker, so apps/worker's local poll loop (packages/workflows/src/publishing.ts's
-- publishDueSchedules) has nowhere free to run continuously. Instead this calls a tick
-- endpoint added to the already-deployed apps/api web service
-- (POST /internal/scheduler/tick, apps/api/src/routes/scheduler.ts) once a minute.
--
-- That endpoint is scoped to platform "x" only and sits behind apps/api's existing
-- sharedSecretAuth middleware (Authorization: Bearer <DASHBOARD_SHARED_SECRET>), not a
-- new x-cron-secret header, so the values below are named for what they hold rather
-- than mirrored 1:1 from the blog job's cron_config keys. Same reasoning as that
-- migration for why they're rows in cron_config instead of inlined here: this file is
-- committed to git and Supabase's hosted "postgres" role can't set custom GUCs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fire-due-x-schedules') THEN
    PERFORM cron.unschedule('fire-due-x-schedules');
  END IF;
END $$;

SELECT cron.schedule(
  'fire-due-x-schedules',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM cron_config WHERE key = 'x_scheduler_tick_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM cron_config WHERE key = 'x_scheduler_tick_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
