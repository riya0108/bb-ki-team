import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@ai-company/core';
import { sql } from './client.js';

const logger = createLogger({ runId: 'db-migrate' });

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');

/**
 * Hand-rolled migration runner (no ORM) per CLAUDE.md: "migrations are the
 * only way schema changes reach the database." Applies migrations/*.sql in
 * filename order, tracking what's applied in schema_migrations so re-runs
 * are a no-op.
 */
async function main(): Promise<void> {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const appliedRows = await sql<{ name: string }[]>`select name from schema_migrations`;
  const applied = new Set(appliedRows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const contents = await readFile(path.join(migrationsDir, file), 'utf-8');
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    logger.info('applied migration', { file });
  }

  logger.info('migrations up to date');
  await sql.end();
}

await main();
