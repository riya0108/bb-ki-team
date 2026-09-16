import { useEffect, useState } from 'react';

import { getContentDna, setUnauthorizedHandler } from './api/client';
import type { Platform } from './api/client';
import { ChatPane } from './components/ChatPane';
import { ContentQueue } from './components/ContentQueue';
import { DraftCanvas } from './components/DraftCanvas';
import { LoginGate } from './components/LoginGate';
import { PlatformTabs } from './components/PlatformTabs';
import { ResizeHandle } from './components/ResizeHandle';
import { ScheduledTracker } from './components/ScheduledTracker';

function hasContentId(result: unknown): result is { contentId: string } {
  return typeof result === 'object' && result !== null && typeof (result as { contentId?: unknown }).contentId === 'string';
}

const CHAT_PANE_MIN_HEIGHT_PX = 140;
const CHAT_PANE_DEFAULT_HEIGHT_PX = 320;

export function App() {
  const [platform, setPlatform] = useState<Platform>('linkedin');
  const [openContentId, setOpenContentId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [chatIsHero, setChatIsHero] = useState(true);
  const [chatPaneHeight, setChatPaneHeight] = useState(CHAT_PANE_DEFAULT_HEIGHT_PX);
  const [locked, setLocked] = useState(false);

  // Fires only when a request actually 401s (client.ts) — which only happens
  // against a deployed apps/api with DASHBOARD_SHARED_SECRET set. Never triggers
  // in local dev.
  useEffect(() => {
    setUnauthorizedHandler(() => setLocked(true));
  }, []);

  function resizeChatPane(deltaY: number) {
    // Dragging the handle up (negative deltaY) should grow the chat pane below it —
    // hence the sign flip — clamped so neither side can be dragged to nothing.
    setChatPaneHeight((h) => {
      const maxHeight = Math.max(CHAT_PANE_MIN_HEIGHT_PX, window.innerHeight * 0.75);
      return Math.min(maxHeight, Math.max(CHAT_PANE_MIN_HEIGHT_PX, h - deltaY));
    });
  }

  function selectPlatform(next: Platform) {
    setPlatform(next);
    setOpenContentId(null);
  }

  function handleChanged() {
    setRefreshToken((t) => t + 1);
  }

  function handleChatAction(_action: string, result: unknown) {
    // A draft/repurpose action's result carries the new contentId — open it
    // automatically so the reply and the canvas stay in sync (spec 17: chat and
    // draft canvas are the same conversation, not two disconnected surfaces).
    if (hasContentId(result)) setOpenContentId(result.contentId);
    handleChanged();
  }

  if (locked) {
    return <LoginGate verify={async () => { await getContentDna(); }} />;
  }

  return (
    <div className="app-shell">
      <div className="bottom-glow" aria-hidden="true" />
      <div className="topbar">
        <div className="brand">
          Teri<span className="brand-dot" />
        </div>
        <PlatformTabs selected={platform} onSelect={selectPlatform} />
        <div className="topbar-right">BB ki Team</div>
      </div>
      <div className="main-layout">
        <ContentQueue platform={platform} selectedId={openContentId} onSelect={setOpenContentId} refreshToken={refreshToken} />
        <div className="center-panel">
          <DraftCanvas contentId={openContentId} onChanged={handleChanged} />
          {!chatIsHero && <ResizeHandle onResize={resizeChatPane} />}
          <div
            className={`chat-pane-wrapper${chatIsHero ? ' is-hero' : ''}`}
            style={chatIsHero ? undefined : { height: chatPaneHeight }}
          >
            <ChatPane
              platform={platform}
              openContentId={openContentId}
              onActionResult={handleChatAction}
              onHeroChange={setChatIsHero}
              onNewChat={() => setOpenContentId(null)}
            />
          </div>
        </div>
      </div>
      <ScheduledTracker refreshToken={refreshToken} />
    </div>
  );
}
