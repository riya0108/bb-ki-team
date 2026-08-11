alter table workflow_runs drop constraint workflow_runs_status_check;
alter table workflow_runs add constraint workflow_runs_status_check
  check (status in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed'));

create table if not exists approvals (
  id text primary key,
  workflow_run_id text not null references workflow_runs (id) on delete cascade,
  gate text not null check (gate in ('topic', 'draft')),
  decision text not null check (decision in ('approved', 'changes_requested')),
  selection jsonb,
  feedback text,
  decided_at timestamptz not null default now()
);

create index if not exists idx_approvals_workflow_run_id on approvals (workflow_run_id);
