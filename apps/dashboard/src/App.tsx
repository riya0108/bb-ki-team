import { useState } from 'react';

import type { Platform } from './api/client';
import { ChatPane } from './components/ChatPane';
import { ContentQueue } from './components/ContentQueue';
import { DnaPanel } from './components/DnaPanel';
import { DraftCanvas } from './components/DraftCanvas';
import { PlatformTabs } from './components/PlatformTabs';

function hasContentId(result: unknown): result is { contentId: string } {
  return typeof result === 'object' && result !== null && typeof (result as { contentId?: unknown }).contentId === 'string';
}

export function App() {
  const [platform, setPlatform] = useState<Platform>('linkedin');
  const [openContentId, setOpenContentId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

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

  return (
    <div className="app-shell">
      <PlatformTabs selected={platform} onSelect={selectPlatform} />
      <div className="main-layout">
        <ContentQueue platform={platform} selectedId={openContentId} onSelect={setOpenContentId} refreshToken={refreshToken} />
        <div className="center-panel">
          <DraftCanvas contentId={openContentId} onChanged={handleChanged} />
          <ChatPane platform={platform} openContentId={openContentId} onActionResult={handleChatAction} />
        </div>
        <DnaPanel refreshToken={refreshToken} />
      </div>
    </div>
  );
}
