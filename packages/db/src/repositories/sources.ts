import type { NewSourceInput, Source } from '@bb/shared-types';
import { SourceSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

interface SourceRow {
  id: string;
  name: string;
  platform: string;
  url: string;
  author: string | null;
  published_at: Date | null;
  accessed_at: Date | null;
  tier: string;
  topics: string[];
  claims: unknown;
  evidence_links: string[];
  relevance_score: string | null;
  risk_score: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: SourceRow): Source {
  return SourceSchema.parse({
    id: row.id,
    name: row.name,
    platform: row.platform,
    url: row.url,
    author: row.author,
    publishedAt: row.published_at?.toISOString() ?? null,
    accessedAt: row.accessed_at?.toISOString() ?? null,
    tier: row.tier,
    topics: row.topics,
    claims: row.claims,
    evidenceLinks: row.evidence_links,
    relevanceScore: row.relevance_score !== null ? Number(row.relevance_score) : null,
    riskScore: row.risk_score !== null ? Number(row.risk_score) : null,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export async function insertSource(db: Queryable, input: NewSourceInput): Promise<Source> {
  const result = await db.query<SourceRow>(
    `INSERT INTO sources (name, platform, url, tier, topics)
     VALUES ($1, $2, $3, $4::source_tier, $5)
     RETURNING *`,
    [input.name, input.platform, input.url, input.tier ?? 'tier_2_secondary', input.topics ?? []],
  );
  const row = result.rows[0];
  if (!row) throw new Error('insertSource: insert returned no row');
  return mapRow(row);
}

export async function listSources(db: Queryable, filter?: { platform?: string; status?: string }): Promise<Source[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter?.platform) {
    values.push(filter.platform);
    conditions.push(`platform = $${values.length}`);
  }
  if (filter?.status) {
    values.push(filter.status);
    conditions.push(`status = $${values.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query<SourceRow>(`SELECT * FROM sources ${where} ORDER BY created_at DESC`, values);
  return result.rows.map(mapRow);
}

export async function getSourceById(db: Queryable, id: string): Promise<Source | null> {
  const result = await db.query<SourceRow>('SELECT * FROM sources WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function updateSourceStatus(db: Queryable, id: string, status: string): Promise<Source | null> {
  const result = await db.query<SourceRow>(
    'UPDATE sources SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [id, status],
  );
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function markSourceAccessed(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE sources SET accessed_at = now(), updated_at = now() WHERE id = $1', [id]);
}
