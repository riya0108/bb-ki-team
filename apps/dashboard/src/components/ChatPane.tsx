import type { ChatMessage } from '@bb/shared-types';
import { useEffect, useRef, useState } from 'react';

import type { Platform } from '../api/client';
import { ApiError, listChatMessages, sendChatMessage } from '../api/client';
import { PlusIcon, SendIcon } from './icons';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
}

interface ChatPaneProps {
  platform: Platform;
  openContentId: string | null;
  onActionResult: (action: string, result: unknown) => void;
}

export function ChatPane({ platform, openContentId, onActionResult }: ChatPaneProps) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    listChatMessages(platform)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages.map((m: ChatMessage) => ({ id: m.id, role: m.role, content: m.content })));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft('');
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: 'user', content: message }]);
    setSending(true);
    try {
      const response = await sendChatMessage(platform, message, openContentId);
      setMessages((prev) => [...prev, { id: response.runId, role: 'assistant', content: response.reply }]);
      onActionResult(response.action, response.result);
    } catch (err) {
      const text = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'error', content: text }]);
    } finally {
      setSending(false);
    }
  }

  function renderComposer(variant?: 'hero') {
    const isHeroVariant = variant === 'hero';
    const composer = (
      <div className={`chat-composer${isHeroVariant ? ' hero-composer' : ''}`}>
        {isHeroVariant && (
          <>
            <span className="composer-plus" aria-hidden="true">
              <PlusIcon />
            </span>
            <span className="composer-label">Ask</span>
            <span className="composer-divider" aria-hidden="true" />
          </>
        )}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={isHeroVariant ? 'anything..' : 'Ask anything..'}
          disabled={sending}
        />
        <button type="button" className="send-button" onClick={() => void send()} disabled={sending || !draft.trim()} aria-label="Send">
          <SendIcon />
        </button>
      </div>
    );

    if (!isHeroVariant) return composer;

    // The animated glow lives on this wrapper (not on .hero-composer itself) so the
    // pill's own opaque background paints over it and hides everything but the edges —
    // a pseudo-element on the pill would paint *above* the pill's own background fill
    // (backgrounds are the bottom-most stacking layer even under negative z-index
    // children) and wash color across the whole input instead of just the border.
    return <div className="hero-composer-glow">{composer}</div>;
  }

  const isHero = messages.length === 0 && !openContentId;

  if (isHero) {
    return (
      <div className="chat-area chat-hero">
        <div className="teri-hero">
          <div className="teri-hero-composer">{renderComposer('hero')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-area">
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
      </div>
      {renderComposer()}
    </div>
  );
}
