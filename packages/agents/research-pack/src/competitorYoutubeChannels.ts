import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from '@ai-company/core';
import type { SearchSource } from './mcpClient.js';

/** From the user's competitor list (2026-08-10) — YouTube channels to track for content-gap analysis. */
const COMPETITOR_YOUTUBE_HANDLES = [
  'GenZway',
  'vaibhavsisinty',
  'designbyarpit',
  'mohak_mangal',
  'jattprabhjot',
  'beebomco',
  'geekyranjit',
  'historyofsimplethings',
  'warikoo',
  'IshanSharma7390',
  'dhruvrathee',
  'financewithsharan',
  'rajshamani',
  'Zero1byZerodha',
  'ThinkSchool',
  'FasBeam',
  'aliabdaal',
  'AlyHajiani',
];

const CACHE_PATH = path.resolve(process.cwd(), '.cache/competitor-youtube-channels.json');
const CacheSchema = z.record(z.string(), z.string());
type Cache = z.infer<typeof CacheSchema>;

const ResolveHandleResultSchema = z.object({ channelId: z.string().optional() });

async function readCache(): Promise<Cache> {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return CacheSchema.parse(JSON.parse(await readFile(CACHE_PATH, 'utf-8')));
  } catch {
    return {};
  }
}

async function writeCache(cache: Cache): Promise<void> {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

/**
 * Resolves the tracked-competitor YouTube handles to channel IDs, once,
 * cached on disk — channel IDs are effectively permanent, so re-resolving on
 * every run would just waste API quota. A handle that fails to resolve is
 * skipped (logged), never fails the whole research run.
 */
export async function resolveCompetitorYoutubeChannelIds(
  youtubeSource: SearchSource | undefined,
  logger: Logger,
): Promise<Set<string>> {
  const cache = await readCache();
  const resolved = new Set<string>(Object.values(cache));
  const missing = COMPETITOR_YOUTUBE_HANDLES.filter((handle) => !(handle in cache));

  if (missing.length === 0 || !youtubeSource) return resolved;

  let cacheChanged = false;
  for (const handle of missing) {
    try {
      const raw = await youtubeSource.callTool('resolve_channel_handle', { handle });
      const { channelId } = ResolveHandleResultSchema.parse(raw);
      if (channelId) {
        cache[handle] = channelId;
        resolved.add(channelId);
        cacheChanged = true;
      } else {
        logger.warn('competitor YouTube handle did not resolve to a channel', { handle });
      }
    } catch (error) {
      logger.warn('failed to resolve competitor YouTube handle, skipping', {
        handle,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (cacheChanged) await writeCache(cache);
  return resolved;
}
