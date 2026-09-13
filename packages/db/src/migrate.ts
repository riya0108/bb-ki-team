import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createPool } from './pool.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

async function ensureMigrationsTable(pool: ReturnType<typeof createPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations(pool: ReturnType<typeof createPool>): Promise<Set<string>> {
  const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  return new Set(result.rows.map((row) => row.name));
}

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const pool = createPool(databaseUrl);
  const applied: string[] = [];
  try {
    await ensureMigrationsTable(pool);
    const alreadyApplied = await getAppliedMigrations(pool);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      } finally {
        client.release();
      }
    }

    return applied;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  const applied = await runMigrations(databaseUrl);
  if (applied.length === 0) {
    // eslint-disable-next-line no-console -- CLI entrypoint output, not library code
    console.log('No new migrations to apply.');
  } else {
    // eslint-disable-next-line no-console -- CLI entrypoint output, not library code
    console.log(`Applied ${applied.length} migration(s):\n${applied.map((f) => `  - ${f}`).join('\n')}`);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
