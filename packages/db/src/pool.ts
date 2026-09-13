import type { PoolClient } from 'pg';
import pg from 'pg';

const { Pool } = pg;
export type { Pool, PoolClient } from 'pg';

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({ connectionString: databaseUrl });
}

// Both Pool and PoolClient satisfy this — repositories accept a Queryable so
// packages/workflows can pass a transaction client through when it needs one.
export interface Queryable {
  query: pg.Pool['query'];
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
