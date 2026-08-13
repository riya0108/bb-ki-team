'use client';

import { useState } from 'react';
import { Camera, Check, Newspaper, Sparkles, Video } from 'lucide-react';
import type { BlogCandidate, TrendSignal } from '@ai-company/shared-types';
import { BlogTopicSearchPanel } from '@/components/contentIntelligence/BlogTopicSearchPanel';
import { TrendSignalSearchPanel } from '@/components/contentIntelligence/TrendSignalSearchPanel';
import { ContentStrategySearchPanel } from '@/components/contentIntelligence/ContentStrategySearchPanel';

type SearchTab = 'blog' | 'youtube' | 'instagram' | 'strategy';

const TABS: { id: SearchTab; label: string; icon: typeof Newspaper }[] = [
  { id: 'blog', label: 'Blog Topic Search', icon: Newspaper },
  { id: 'youtube', label: 'YouTube Viral Search', icon: Video },
  { id: 'instagram', label: 'Instagram Viral Search', icon: Camera },
  { id: 'strategy', label: 'Content Strategy Search', icon: Sparkles },
];

/**
 * Content Intelligence's front door: 4 independent search engines, each its
 * own workflow run on its own agent — blog-topic-finder, youtube-viral-finder,
 * instagram-viral-finder, content-strategy. They are deliberately NOT run
 * together: only one tab (one search) is active at a time, and running a
 * search shows only that search's own results. The Content Strategy search
 * (engine 4) is the exception in that it *takes* the other 3's results as
 * its input if you've run them — but you have to run it yourself; nothing
 * auto-chains into it. Once it produces a topic and you approve it, the run
 * moves on to the Research Agent automatically — check that department (and
 * Content, Blog Agent) to follow it the rest of the way.
 */
export function ContentIntelligenceDepartmentView() {
  const [activeTab, setActiveTab] = useState<SearchTab>('blog');
  const [blogCandidates, setBlogCandidates] = useState<BlogCandidate[] | null>(null);
  const [youtubeSignals, setYoutubeSignals] = useState<TrendSignal[] | null>(null);
  const [instagramSignals, setInstagramSignals] = useState<TrendSignal[] | null>(null);

  const blogTopics = blogCandidates?.map((c) => c.topic);

  const hasRun: Record<Exclude<SearchTab, 'strategy'>, boolean> = {
    blog: blogCandidates !== null,
    youtube: youtubeSignals !== null,
    instagram: instagramSignals !== null,
  };
  const runCount = Object.values(hasRun).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 rounded-xl border border-neutral-200 bg-white/60 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeTab === id
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id !== 'strategy' && hasRun[id] && (
              <Check className={`h-3.5 w-3.5 ${activeTab === id ? '' : 'text-emerald-500'}`} />
            )}
          </button>
        ))}
      </div>

      {activeTab === 'strategy' && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400">
          Content Strategy ranks whatever you&apos;ve already run above ({runCount} of 3 searches done this
          session) — it doesn&apos;t run them for you. Run Blog/YouTube/Instagram first for a fuller ranking, or
          run it now with just what&apos;s here.
        </p>
      )}

      {activeTab === 'blog' && <BlogTopicSearchPanel onResult={setBlogCandidates} />}

      {activeTab === 'youtube' && (
        <TrendSignalSearchPanel
          apiPath="/api/content-intelligence/youtube-signals/run"
          accentClassName="focus:border-red-500 dark:focus:border-red-600"
          buttonClassName="bg-red-600 hover:bg-red-500"
          icon={<Video className="h-4 w-4" />}
          placeholder="Topics/keywords to search on YouTube — e.g. AI coding assistants, comma or newline separated"
          runningLabel="Searching…"
          idleLabel="Search YouTube signals"
          emptyHint="Run this search to see YouTube viral signals here."
          {...(blogTopics ? { prefillTopics: blogTopics } : {})}
          onResult={setYoutubeSignals}
        />
      )}

      {activeTab === 'instagram' && (
        <TrendSignalSearchPanel
          apiPath="/api/content-intelligence/instagram-signals/run"
          accentClassName="focus:border-fuchsia-500 dark:focus:border-fuchsia-600"
          buttonClassName="bg-fuchsia-600 hover:bg-fuchsia-500"
          icon={<Camera className="h-4 w-4" />}
          placeholder="Topics/keywords to search on Instagram — e.g. AI coding assistants, comma or newline separated"
          runningLabel="Searching…"
          idleLabel="Search Instagram signals"
          emptyHint="Run this search to see Instagram viral signals here."
          {...(blogTopics ? { prefillTopics: blogTopics } : {})}
          onResult={setInstagramSignals}
        />
      )}

      {activeTab === 'strategy' && (
        <ContentStrategySearchPanel
          blogCandidates={blogCandidates}
          youtubeSignals={youtubeSignals}
          instagramSignals={instagramSignals}
        />
      )}
    </div>
  );
}
