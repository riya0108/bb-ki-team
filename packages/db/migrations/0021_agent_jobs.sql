-- agent_jobs: the task queue between the deployed API (Render) and a worker running
-- somewhere else — today, the Blog agent's worker on the operator's Mac, where the
-- Claude Code CLI (the operator's own Claude plan) is installed and logged in.
--
-- The deployed API records the user's chat message and enqueues a job; the worker
-- claims it (FOR UPDATE SKIP LOCKED), runs the head agent, and writes the outcome
-- back here. The dashboard polls the job. Nothing reaches into the operator's
-- machine: the worker only makes outbound connections to this database.
--
-- A job whose worker died mid-run (laptop closed, process killed) stops sending
-- heartbeats; the next claim treats it as abandoned and retries it, up to a fixed
-- number of attempts, after which it is failed with an explicit error.
CREATE TYPE agent_job_status AS ENUM ('queued', 'running', 'done', 'failed');

CREATE TABLE agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  -- What the worker should run; 'chat' = one head-agent chat message.
  kind text NOT NULL,
  session_id uuid REFERENCES chat_sessions (id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status agent_job_status NOT NULL DEFAULT 'queued',
  -- Set when done: { reply, action, result } — what the synchronous route returned.
  result jsonb,
  error text,
  attempts int NOT NULL DEFAULT 0,
  worker_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX agent_jobs_claim_idx ON agent_jobs (platform, status, created_at);
CREATE INDEX agent_jobs_session_idx ON agent_jobs (session_id, created_at DESC);

-- Same lockdown as every other table (migration 0017): the app connects as the
-- postgres role, so no PostgREST client can read or write the queue.
ALTER TABLE agent_jobs ENABLE ROW LEVEL SECURITY;
