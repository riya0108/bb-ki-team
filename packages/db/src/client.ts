import postgres from 'postgres';
import { z } from 'zod';
import { loadEnv } from '@ai-company/core';

const env = loadEnv(
  z.object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required to connect to Postgres'),
  }),
);

/**
 * Shared Postgres connection for this process. `apps/api` and `apps/worker`
 * each import this once — `postgres` pools connections internally, so
 * modules should reuse this export rather than opening their own.
 */
export const sql = postgres(env.DATABASE_URL);

/**
 * `sql.json` requires `postgres.JSONValue`, but task/workflow-run payloads
 * are validated against agent-specific Zod schemas one layer up (not here) —
 * this narrow cast is the single point where "already-validated unknown" is
 * asserted JSON-serializable for the driver.
 */
export function toJsonValue(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}
