-- A human cancelling a pending schedule from the dashboard (packages/workflows'
-- cancelSchedule) is a distinct, auditable outcome from a publish/schedule ATTEMPT
-- succeeding or failing (spec 15.3/15.4) — it never touched the connector at all.
ALTER TYPE publish_result ADD VALUE 'cancelled';
