create table if not exists workflow_runs (
  id text primary key,
  workflow_name text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists tasks (
  id text primary key,
  workflow_run_id text not null references workflow_runs (id) on delete cascade,
  agent text not null,
  task_type text not null,
  status text not null check (status in ('pending', 'claimed', 'running', 'succeeded', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts int not null default 0,
  max_attempts int not null default 3,
  available_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  depends_on_task_id text references tasks (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_status_available on tasks (status, available_at);
create index if not exists idx_tasks_workflow_run_id on tasks (workflow_run_id);
