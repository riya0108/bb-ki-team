import type { StyleMetrics, StyleSample, StyleSampleKind, StyleTraits } from '@bb/shared-types';
import { StyleSampleSchema } from '@bb/shared-types';

import type { Queryable } from '../pool.js';

// blog_style_samples (migration 0020): abstracted metrics/traits only, never text.

interface StyleSampleRow {
  id: string;
  kind: StyleSampleKind;
  label: string;
  source_url: string | null;
  content_id: string | null;
  metrics: unknown;
  traits: unknown;
  active: boolean;
  created_at: Date;
}

function mapRow(row: StyleSampleRow): StyleSample {
  return StyleSampleSchema.parse({
    id: row.id,
    kind: row.kind,
    label: row.label,
    sourceUrl: row.source_url,
    contentId: row.content_id,
    metrics: row.metrics,
    traits: row.traits,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  });
}

export interface NewStyleSampleInput {
  kind: StyleSampleKind;
  label: string;
  sourceUrl: string | null;
  contentId: string | null;
  metrics: StyleMetrics;
  traits: StyleTraits;
}

// An approved article's sample is replaced on re-approval rather than duplicated.
export async function upsertStyleSample(db: Queryable, input: NewStyleSampleInput): Promise<StyleSample> {
  const params = [input.kind, input.label, input.sourceUrl, input.contentId, JSON.stringify(input.metrics), JSON.stringify(input.traits)];
  const result =
    input.contentId !== null
      ? await db.query<StyleSampleRow>(
          `INSERT INTO blog_style_samples (kind, label, source_url, content_id, metrics, traits)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (content_id) WHERE content_id IS NOT NULL
           DO UPDATE SET label = EXCLUDED.label, metrics = EXCLUDED.metrics, traits = EXCLUDED.traits, active = true
           RETURNING *`,
          params,
        )
      : await db.query<StyleSampleRow>(
          `INSERT INTO blog_style_samples (kind, label, source_url, content_id, metrics, traits)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          params,
        );
  const row = result.rows[0];
  if (!row) throw new Error('upsertStyleSample: insert returned no row');
  return mapRow(row);
}

export async function listActiveStyleSamples(db: Queryable, limit = 50): Promise<StyleSample[]> {
  const result = await db.query<StyleSampleRow>(
    `SELECT * FROM blog_style_samples WHERE active ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapRow);
}

export async function deactivateStyleSample(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE blog_style_samples SET active = false WHERE id = $1', [id]);
}

export interface BlogArticleIndexEntry {
  contentId: string;
  status: string;
  topic: string | null;
  title: string;
  slug: string;
  thesis: string | null;
  primaryAngle: string | null;
  topicKey: string | null;
  category: string | null;
  // The live URL from the latest successful publish event, when there is one —
  // only these are safe internal-link targets.
  publishedUrl: string | null;
  createdAt: string;
}

interface BlogIndexRow {
  id: string;
  status: string;
  topic: string | null;
  title: string | null;
  slug: string | null;
  thesis: string | null;
  primary_angle: string | null;
  topic_key: string | null;
  category: string | null;
  published_url: string | null;
  created_at: Date;
}

// Spec 47: enough structured metadata about every blog article to answer "have we
// covered this / this angle before?" and to suggest internal links, read straight from
// content_items.package (no separate article table).
export async function listBlogArticleIndex(db: Queryable, options: { excludeContentId?: string; limit?: number } = {}): Promise<BlogArticleIndexEntry[]> {
  const result = await db.query<BlogIndexRow>(
    `SELECT id, status, topic, created_at,
            package->'titleOptions'->>0 AS title,
            package->>'slug' AS slug,
            COALESCE(package->'editorialArchitecture'->>'thesis', package->>'thesis') AS thesis,
            package->'editorialArchitecture'->>'primaryAngle' AS primary_angle,
            package->'editorialBrief'->>'topicKey' AS topic_key,
            package->>'category' AS category,
            (SELECT pe.platform_url FROM publish_events pe
              WHERE pe.content_id = content_items.id AND pe.result = 'success' AND pe.platform_url IS NOT NULL
              ORDER BY pe.created_at DESC LIMIT 1) AS published_url
     FROM content_items
     WHERE platform = 'blog'
       AND status <> 'rejected'
       AND ($1::uuid IS NULL OR id <> $1::uuid)
     ORDER BY created_at DESC
     LIMIT $2`,
    [options.excludeContentId ?? null, options.limit ?? 200],
  );
  return result.rows
    .filter((r) => r.title !== null && r.slug !== null)
    .map((r) => ({
      contentId: r.id,
      status: r.status,
      topic: r.topic,
      title: r.title ?? '',
      slug: r.slug ?? '',
      thesis: r.thesis,
      primaryAngle: r.primary_angle,
      topicKey: r.topic_key,
      category: r.category,
      publishedUrl: r.published_url,
      createdAt: r.created_at.toISOString(),
    }));
}
