import type { ScoredTopic } from '@ai-company/shared-types';
import { ScorePill } from '@/components/ui/ScorePill';

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function TopicCard({ topic }: { topic: ScoredTopic }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium text-white">{topic.topic}</h4>
        <ScorePill score={topic.score} />
      </div>
      <p className="mt-2 text-sm text-neutral-400">{topic.reason}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {topic.sources.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="max-w-[220px] truncate text-xs text-violet-400 underline decoration-violet-800 underline-offset-2 hover:text-violet-300"
          >
            {hostnameOf(url)}
          </a>
        ))}
      </div>
    </div>
  );
}
