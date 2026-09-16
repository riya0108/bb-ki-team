import { useEffect, useState } from 'react';

import type { Platform } from '../api/client';
import { PLATFORM_LABELS, listContent, listPublishEvents } from '../api/client';

interface PlatformCount {
  platform: Platform;
  count: number;
}

// Ring is a decorative activity indicator, not a literal fraction of a target
// (there's no "goal" concept in this app) — fill proportionally up to this many
// scheduled posts, then read as full.
const RING_VISUAL_MAX = 6;
const RING_RADIUS = 19;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isKnownPlatform(value: string): value is Platform {
  return value in PLATFORM_LABELS;
}

// Scheduling time lives on publish_events (requestSchedule), not on the content
// item itself — so "today's scheduled posts" means: every content item currently
// in 'scheduled' status, cross-referenced against its own publish-event history
// for the schedule attempt whose scheduledFor date is today (spec 15's ledger is
// the only source of truth for this, there's no denormalized field to read instead).
export function ScheduledTracker({ refreshToken }: { refreshToken: number }) {
  const [counts, setCounts] = useState<PlatformCount[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      const { items } = await listContent({ status: 'scheduled' });
      const perPlatform = new Map<Platform, number>();

      await Promise.all(
        items.map(async (item) => {
          if (!isKnownPlatform(item.platform)) return;
          const { events } = await listPublishEvents(item.id);
          const scheduledToday = events.some((event) => event.scheduledFor && isToday(event.scheduledFor));
          if (!scheduledToday) return;
          perPlatform.set(item.platform, (perPlatform.get(item.platform) ?? 0) + 1);
        }),
      );

      if (cancelled) return;
      setCounts(
        [...perPlatform.entries()]
          .map(([platform, count]) => ({ platform, count }))
          .sort((a, b) => b.count - a.count),
      );
    }

    load().catch(() => {
      if (!cancelled) setCounts([]);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  if (counts === null) return null;

  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const fraction = Math.min(total / RING_VISUAL_MAX, 1);
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction);

  // Header widget is compact (ring + count only) — the per-platform breakdown
  // that used to render inline lives in the title tooltip instead, since the
  // topbar has no room for a multi-line detail column.
  const detail =
    total === 0 ? 'Nothing scheduled yet' : counts.map((c) => `${PLATFORM_LABELS[c.platform]} · ${c.count}`).join(', ');

  return (
    <div className="scheduled-tracker" title={`Scheduled today: ${total}${total === 0 ? '' : ` (${detail})`}`}>
      <div className="scheduled-tracker-ring-wrap">
        <svg viewBox="0 0 48 48" className="scheduled-tracker-ring">
          <circle cx="24" cy="24" r={RING_RADIUS} className="ring-track" />
          <circle
            cx="24"
            cy="24"
            r={RING_RADIUS}
            className="ring-fill"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <span className="scheduled-tracker-count">{total}</span>
      </div>
    </div>
  );
}
