alter table workflow_runs drop constraint workflow_runs_status_check;
alter table workflow_runs add constraint workflow_runs_status_check
  check (status in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'));

alter table workflow_runs add column cancel_requested_at timestamptz;

alter table tasks drop constraint tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('pending', 'claimed', 'running', 'succeeded', 'failed', 'cancelled'));
